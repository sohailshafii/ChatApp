import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from '@chatapp/shared';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/pool.js';
import { createSession } from '../auth/sessions.js';

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
  await query('TRUNCATE accounts RESTART IDENTITY CASCADE'); // cascades to push_subscriptions
});

const CSRF = 'test-csrf-token';

async function authed(username = 'alice') {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (username, email, password_hash, verified)
     VALUES ($1, $2, 'x', true) RETURNING id`,
    [username, `${username}@example.com`],
  );
  const id = rows[0]!.id;
  const token = await createSession(id);
  return {
    id,
    cookie: `${SESSION_COOKIE_NAME}=${token}; ${CSRF_COOKIE_NAME}=${CSRF}`,
  };
}

const SUB = {
  endpoint: 'https://push.example.com/sub/abc123',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

describe('GET /push/vapid-public-key', () => {
  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/push/vapid-public-key' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the configured key', async () => {
    const { cookie } = await authed();
    const res = await app.inject({
      method: 'GET',
      url: '/push/vapid-public-key',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().publicKey).toBe('test-vapid-public-key');
  });
});

describe('POST /push/subscriptions', () => {
  it('requires the CSRF token', async () => {
    const { cookie } = await authed();
    const res = await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: { cookie },
      payload: SUB,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf_failure');
  });

  it('registers a subscription idempotently and audits it', async () => {
    const { id, cookie } = await authed();
    const post = (sub: typeof SUB) =>
      app.inject({
        method: 'POST',
        url: '/push/subscriptions',
        headers: { cookie, [CSRF_HEADER_NAME]: CSRF },
        payload: sub,
      });

    expect((await post(SUB)).statusCode).toBe(200);
    // Re-register the same endpoint with refreshed keys → still one row.
    expect((await post({ ...SUB, keys: { p256dh: 'new', auth: 'new2' } })).statusCode).toBe(200);

    const rows = await query<{ p256dh: string }>(
      'SELECT p256dh FROM push_subscriptions WHERE account_id = $1',
      [id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.p256dh).toBe('new'); // refreshed

    const audit = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM auth_audit_log WHERE event = 'push_subscription_added'",
    );
    expect(audit.rows[0]!.n).toBe(2);
  });
});

describe('DELETE /push/subscriptions', () => {
  it('removes the caller’s own subscription and audits it', async () => {
    const { id, cookie } = await authed();
    await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: { cookie, [CSRF_HEADER_NAME]: CSRF },
      payload: SUB,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/push/subscriptions',
      headers: { cookie, [CSRF_HEADER_NAME]: CSRF },
      payload: { endpoint: SUB.endpoint },
    });
    expect(res.statusCode).toBe(204);

    const rows = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM push_subscriptions WHERE account_id = $1',
      [id],
    );
    expect(rows.rows[0]!.n).toBe(0);
    const audit = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM auth_audit_log WHERE event = 'push_subscription_removed'",
    );
    expect(audit.rows[0]!.n).toBe(1);
  });

  it('does not delete another user’s subscription', async () => {
    const alice = await authed('alice');
    const bob = await authed('bob');
    await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: { cookie: alice.cookie, [CSRF_HEADER_NAME]: CSRF },
      payload: SUB,
    });
    // Bob tries to delete alice's endpoint — scoped by account, so it's a no-op.
    await app.inject({
      method: 'DELETE',
      url: '/push/subscriptions',
      headers: { cookie: bob.cookie, [CSRF_HEADER_NAME]: CSRF },
      payload: { endpoint: SUB.endpoint },
    });
    const rows = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM push_subscriptions WHERE account_id = $1',
      [alice.id],
    );
    expect(rows.rows[0]!.n).toBe(1); // still there
  });
});
