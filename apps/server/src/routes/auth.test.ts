import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from '@chatapp/shared';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/pool.js';

// Exercises the §1 auth flow end-to-end against the dedicated test database
// (provisioned in global-setup) — the curl flow from apps/server/CLAUDE.md,
// using Fastify's in-process injector instead of the network.

const PASSWORD = 'correct horse battery staple';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

afterEach(async () => {
  await query(
    'TRUNCATE accounts, sessions, email_verification_tokens RESTART IDENTITY CASCADE',
  );
});

function getCookie(res: InjectResponse, name: string) {
  const cookie = res.cookies.find((c) => c.name === name);
  if (!cookie) throw new Error(`expected a ${name} cookie to be set`);
  return cookie;
}

function signup(
  username = 'alice',
  email = 'alice@example.com',
): Promise<InjectResponse> {
  return app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { username, email, password: PASSWORD },
  });
}

async function createVerifiedUser(username = 'alice'): Promise<void> {
  const res = await signup(username, `${username}@example.com`);
  expect(res.statusCode).toBe(200);
  await query('UPDATE accounts SET verified = true WHERE username = $1', [
    username,
  ]);
}

// Logs in and returns the session/csrf cookie values plus a ready Cookie header.
async function login(username = 'alice') {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  const session = getCookie(res, SESSION_COOKIE_NAME).value;
  const csrf = getCookie(res, CSRF_COOKIE_NAME).value;
  return {
    res,
    session,
    csrf,
    cookie: `${SESSION_COOKIE_NAME}=${session}; ${CSRF_COOKIE_NAME}=${csrf}`,
  };
}

describe('POST /auth/signup', () => {
  it('creates an account and returns 200 with an empty body', async () => {
    const res = await signup();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    const { rows } = await query<{ verified: boolean }>(
      'SELECT verified FROM accounts WHERE username = $1',
      ['alice'],
    );
    expect(rows[0]?.verified).toBe(false);
  });

  it('rejects a duplicate username / email with the precise code', async () => {
    await signup('alice', 'alice@example.com');
    const dupUser = await signup('alice', 'other@example.com');
    expect(dupUser.statusCode).toBe(409);
    expect(dupUser.json().error.code).toBe('username_taken');

    const dupEmail = await signup('bob', 'alice@example.com');
    expect(dupEmail.statusCode).toBe(409);
    expect(dupEmail.json().error.code).toBe('email_taken');
  });
});

describe('POST /auth/login', () => {
  it('rejects an unverified account (correct password) with 403 unverified', async () => {
    await signup();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'alice', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('unverified');
  });

  it('rejects a wrong password with 401 invalid_credentials', async () => {
    await createVerifiedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'alice', password: 'nope nope nope' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
  });

  it('rejects an unknown username with the same generic 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ghost', password: PASSWORD },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
  });

  it('logs in a verified user, returns the user, and sets the cookies', async () => {
    await createVerifiedUser();
    const { res } = await login();

    expect(res.json().user).toMatchObject({
      username: 'alice',
      email: 'alice@example.com',
      verified: true,
    });

    const session = getCookie(res, SESSION_COOKIE_NAME);
    const csrf = getCookie(res, CSRF_COOKIE_NAME);
    expect(session.httpOnly).toBe(true);
    expect(String(session.sameSite).toLowerCase()).toBe('lax');
    expect(csrf.httpOnly).toBeFalsy(); // readable so the client can echo it

    const { rows } = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sessions',
    );
    expect(rows[0]?.count).toBe('1');
  });
});

describe('GET /auth/me', () => {
  it('returns the user with a valid session cookie', async () => {
    await createVerifiedUser();
    const { cookie } = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('alice');
  });

  it('returns 401 without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });
});

describe('POST /auth/logout', () => {
  it('requires the double-submit CSRF token', async () => {
    await createVerifiedUser();
    const { cookie } = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie }, // no X-CSRF-Token header
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf_failure');
  });

  it('clears the session when the CSRF token matches', async () => {
    await createVerifiedUser();
    const { cookie, csrf } = await login();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie, [CSRF_HEADER_NAME]: csrf },
    });
    expect(res.statusCode).toBe(204);

    // Session row gone, and the now-stale cookie no longer authenticates.
    const { rows } = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sessions',
    );
    expect(rows[0]?.count).toBe('0');

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(401);
  });
});
