import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from '@chatapp/shared';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/pool.js';
import { generateToken } from '../auth/tokens.js';
import { authLimiter, AUTH_LIMITS } from '../rate-limit/auth-rate-limit.js';
import { createExport } from '../auth/data-export.js';

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
    'TRUNCATE accounts, sessions, email_verification_tokens, password_reset_tokens, conversations RESTART IDENTITY CASCADE',
  );
  authLimiter.reset(); // keep rate-limit windows from leaking across tests
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

describe('DELETE /auth/account (§6)', () => {
  async function seedHumanConversation(a: string, b: string): Promise<string> {
    const { rows } = await query<{ id: string }>(
      'INSERT INTO conversations DEFAULT VALUES RETURNING id',
    );
    const id = rows[0]!.id;
    await query(
      `INSERT INTO conversation_participants (conversation_id, account_id)
       VALUES ($1, $2), ($1, $3)`,
      [id, a, b],
    );
    await query(
      `INSERT INTO messages (conversation_id, sender_id, content)
       VALUES ($1, $2, 'from alice'), ($1, $3, 'from bob')`,
      [id, a, b],
    );
    return id;
  }
  async function seedBotConversation(a: string): Promise<string> {
    const { rows } = await query<{ id: string }>(
      "INSERT INTO conversations (bot_id) VALUES ('assistant') RETURNING id",
    );
    const id = rows[0]!.id;
    await query(
      'INSERT INTO conversation_participants (conversation_id, account_id) VALUES ($1, $2)',
      [id, a],
    );
    await query(
      "INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, 'hi bot')",
      [id, a],
    );
    return id;
  }
  const del = (cookie: string, csrf: string, password: string) =>
    app.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers: { cookie, [CSRF_HEADER_NAME]: csrf },
      payload: { password },
    });

  it('requires the CSRF token', async () => {
    await createVerifiedUser();
    const { cookie } = await login();
    const res = await app.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers: { cookie }, // no X-CSRF-Token
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf_failure');
  });

  it('rejects a wrong password and keeps the account', async () => {
    await createVerifiedUser();
    const { cookie, csrf } = await login();
    const res = await del(cookie, csrf, 'not my password');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM accounts',
    );
    expect(rows[0]!.n).toBe(1); // still there
  });

  it('hard-deletes the account, drops bot convos, retains human history, audits', async () => {
    await createVerifiedUser('alice');
    await createVerifiedUser('bob');
    const aliceId = await accountIdByUsername('alice');
    const bobId = await accountIdByUsername('bob');
    const humanConv = await seedHumanConversation(aliceId, bobId);
    const botConv = await seedBotConversation(aliceId);

    const { cookie, csrf } = await login('alice');
    const res = await del(cookie, csrf, PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');

    // Account + its sessions gone; the prior cookie no longer authenticates.
    expect(
      (await query<{ n: number }>('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [aliceId])).rows[0]!.n,
    ).toBe(0);
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);

    // Bot conversation hard-deleted (messages cascade); human conversation and
    // alice's message copies retained.
    expect(
      (await query<{ n: number }>('SELECT count(*)::int AS n FROM conversations WHERE id = $1', [botConv])).rows[0]!.n,
    ).toBe(0);
    expect(
      (await query<{ n: number }>('SELECT count(*)::int AS n FROM conversations WHERE id = $1', [humanConv])).rows[0]!.n,
    ).toBe(1);
    expect(
      (await query<{ n: number }>('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [humanConv])).rows[0]!.n,
    ).toBe(2);

    // account_deletion recorded; all of alice's audit rows survive with a null
    // account_id (ON DELETE SET NULL) now that the account is gone.
    const audit = await query<{ event: string; account_id: string | null }>(
      'SELECT event, account_id FROM auth_audit_log',
    );
    expect(
      audit.rows.some(
        (r) => r.event === 'account_deletion' && r.account_id === null,
      ),
    ).toBe(true);
    expect(audit.rows.every((r) => r.account_id === null)).toBe(true);
  });

  it("shows the deleted peer as 'Deleted user' in the survivor's list", async () => {
    await createVerifiedUser('alice');
    await createVerifiedUser('bob');
    const aliceId = await accountIdByUsername('alice');
    const bobId = await accountIdByUsername('bob');
    await seedHumanConversation(aliceId, bobId);

    const alice = await login('alice');
    await del(alice.cookie, alice.csrf, PASSWORD);

    const bob = await login('bob');
    const list = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { cookie: bob.cookie },
    });
    expect(list.statusCode).toBe(200);
    const { conversations } = list.json();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].peer).toEqual({
      kind: 'human',
      id: '00000000-0000-0000-0000-000000000000',
      username: 'Deleted user',
    });
    expect(conversations[0].lastMessage).not.toBeNull(); // history intact
  });
});

async function accountIdByUsername(username = 'alice'): Promise<string> {
  const { rows } = await query<{ id: string }>(
    'SELECT id FROM accounts WHERE username = $1',
    [username],
  );
  if (!rows[0]) throw new Error(`no account ${username}`);
  return rows[0].id;
}

// Mints a verification token for an account and returns the RAW value. The route
// only ever sees the raw token (the DB stores its hash), so tests generate their
// own rather than scraping the logged link.
async function insertVerificationToken(
  accountId: string,
  { expired = false } = {},
): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + (expired ? -60_000 : 60_000));
  await query(
    `INSERT INTO email_verification_tokens (token_hash, account_id, expires_at)
     VALUES ($1, $2, $3)`,
    [token.hash, accountId, expiresAt],
  );
  return token.raw;
}

async function tokenCount(accountId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    'SELECT count(*)::text AS count FROM email_verification_tokens WHERE account_id = $1',
    [accountId],
  );
  return Number(rows[0]?.count ?? '0');
}

describe('POST /auth/verify-email', () => {
  it('verifies a valid token and closes the signup -> verify -> login loop', async () => {
    await signup(); // unverified
    const id = await accountIdByUsername();
    const raw = await insertVerificationToken(id);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: raw },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');

    const { rows } = await query<{ verified: boolean }>(
      'SELECT verified FROM accounts WHERE id = $1',
      [id],
    );
    expect(rows[0]?.verified).toBe(true);
    expect(await tokenCount(id)).toBe(0); // all tokens consumed

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'alice', password: PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it('rejects a malformed token with validation_error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('rejects a well-formed but unknown token with 400 invalid_token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: generateToken().raw },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_token');
  });

  it('rejects and prunes an expired token with 410 expired_token', async () => {
    await signup(); // creates one (live) token
    const id = await accountIdByUsername();
    const raw = await insertVerificationToken(id, { expired: true });
    expect(await tokenCount(id)).toBe(2);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: raw },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('expired_token');

    const { rows } = await query<{ verified: boolean }>(
      'SELECT verified FROM accounts WHERE id = $1',
      [id],
    );
    expect(rows[0]?.verified).toBe(false);
    expect(await tokenCount(id)).toBe(1); // only the expired one was pruned
  });
});

describe('POST /auth/verify-email/resend', () => {
  it('reissues a fresh token for an unverified account', async () => {
    await signup();
    const id = await accountIdByUsername();
    const before = await query<{ token_hash: string }>(
      'SELECT token_hash FROM email_verification_tokens WHERE account_id = $1',
      [id],
    );
    const originalHash = before.rows[0]?.token_hash;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: { email: 'alice@example.com' },
    });
    expect(res.statusCode).toBe(200);

    expect(await tokenCount(id)).toBe(1); // replaced, not accumulated
    const after = await query<{ token_hash: string; expires_at: Date }>(
      'SELECT token_hash, expires_at FROM email_verification_tokens WHERE account_id = $1',
      [id],
    );
    expect(after.rows[0]?.token_hash).not.toBe(originalHash);
    expect(after.rows[0]!.expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns a generic 200 for an unknown email and creates nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: { email: 'nobody@example.com' },
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM accounts',
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('does not reissue for an already-verified account', async () => {
    await signup();
    const id = await accountIdByUsername();
    await query('UPDATE accounts SET verified = true WHERE id = $1', [id]);
    await query('DELETE FROM email_verification_tokens WHERE account_id = $1', [
      id,
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: { email: 'alice@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(await tokenCount(id)).toBe(0);
  });
});

async function insertPasswordResetToken(
  accountId: string,
  { expired = false } = {},
): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + (expired ? -60_000 : 60_000));
  await query(
    `INSERT INTO password_reset_tokens (token_hash, account_id, expires_at)
     VALUES ($1, $2, $3)`,
    [token.hash, accountId, expiresAt],
  );
  return token.raw;
}

async function resetTokenCount(accountId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    'SELECT count(*)::text AS count FROM password_reset_tokens WHERE account_id = $1',
    [accountId],
  );
  return Number(rows[0]?.count ?? '0');
}

describe('POST /auth/password-reset/request', () => {
  it('issues a reset token for a username identifier', async () => {
    await createVerifiedUser();
    const id = await accountIdByUsername();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { identifier: 'alice' },
    });
    expect(res.statusCode).toBe(200);
    expect(await resetTokenCount(id)).toBe(1);
  });

  it('issues a reset token for an email identifier', async () => {
    await createVerifiedUser();
    const id = await accountIdByUsername();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { identifier: 'alice@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(await resetTokenCount(id)).toBe(1);
  });

  it('returns a generic 200 for an unknown identifier, creating nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { identifier: 'ghost' },
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM password_reset_tokens',
    );
    expect(rows[0]?.count).toBe('0');
  });
});

describe('POST /auth/password-reset/confirm', () => {
  const NEW_PASSWORD = 'a brand new passphrase';

  it('sets the new password, kills sessions, and consumes the token', async () => {
    await createVerifiedUser();
    const id = await accountIdByUsername();
    const { cookie } = await login(); // an active session that the reset must kill
    const raw = await insertPasswordResetToken(id);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: raw, newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(await resetTokenCount(id)).toBe(0);

    // Log out everywhere: the prior session no longer authenticates.
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(401);

    // Old password rejected, new password accepted.
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'alice', password: PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'alice', password: NEW_PASSWORD },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects an unknown token with 400 invalid_token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: generateToken().raw, newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_token');
  });

  it('rejects an expired token with 410 expired_token', async () => {
    await createVerifiedUser();
    const id = await accountIdByUsername();
    const raw = await insertPasswordResetToken(id, { expired: true });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: raw, newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('expired_token');
  });

  it('rejects a too-short new password with validation_error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: generateToken().raw, newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

describe('auth audit log (§6)', () => {
  async function auditRows() {
    const { rows } = await query<{ event: string; account_id: string | null }>(
      'SELECT event, account_id FROM auth_audit_log ORDER BY created_at',
    );
    return rows;
  }

  it('records a successful login', async () => {
    await createVerifiedUser();
    const id = await accountIdByUsername();
    await login();
    expect(await auditRows()).toEqual([{ event: 'login', account_id: id }]);
  });

  it('records a wrong-password attempt as login_failure for the account', async () => {
    await createVerifiedUser();
    const id = await accountIdByUsername();
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'alice', password: 'wrong password' },
    });
    expect(await auditRows()).toEqual([
      { event: 'login_failure', account_id: id },
    ]);
  });

  it('records an unknown-username attempt as login_failure with no account', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ghost', password: 'whatever password' },
    });
    expect(await auditRows()).toEqual([
      { event: 'login_failure', account_id: null },
    ]);
  });

  it('records a completed password reset', async () => {
    await createVerifiedUser();
    const id = await accountIdByUsername();
    const raw = await insertPasswordResetToken(id);
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: raw, newPassword: 'a brand new passphrase' },
    });
    expect(await auditRows()).toEqual([
      { event: 'password_reset', account_id: id },
    ]);
  });
});

describe('data export (§6)', () => {
  const exportReq = (cookie: string, csrf?: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/export',
      headers: csrf ? { cookie, [CSRF_HEADER_NAME]: csrf } : { cookie },
    });

  it('requires the CSRF token', async () => {
    await createVerifiedUser();
    const { cookie } = await login();
    const res = await exportReq(cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf_failure');
  });

  it('accepts the request (200 empty) and audits it', async () => {
    await createVerifiedUser();
    const { cookie, csrf } = await login();
    const res = await exportReq(cookie, csrf);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    const audit = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM auth_audit_log WHERE event = 'data_export_requested'",
    );
    expect(audit.rows[0]!.n).toBe(1);
  });

  it('rate-limits repeated requests per account', async () => {
    await createVerifiedUser();
    const { cookie, csrf } = await login();
    for (let i = 0; i < AUTH_LIMITS.exportPerAccount.max; i++) {
      expect((await exportReq(cookie, csrf)).statusCode).toBe(200);
    }
    const blocked = await exportReq(cookie, csrf);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');
  });

  it('generates a downloadable archive with profile + conversations + messages', async () => {
    await createVerifiedUser('alice');
    await createVerifiedUser('bob');
    const aliceId = await accountIdByUsername('alice');
    const bobId = await accountIdByUsername('bob');
    // a human conversation with two messages, and a bot conversation
    const { rows: hc } = await query<{ id: string }>(
      'INSERT INTO conversations DEFAULT VALUES RETURNING id',
    );
    const humanConv = hc[0]!.id;
    await query(
      `INSERT INTO conversation_participants (conversation_id, account_id)
       VALUES ($1,$2),($1,$3)`,
      [humanConv, aliceId, bobId],
    );
    await query(
      `INSERT INTO messages (conversation_id, sender_id, content)
       VALUES ($1,$2,'hello from alice'),($1,$3,'hi from bob')`,
      [humanConv, aliceId, bobId],
    );
    const { rows: bc } = await query<{ id: string }>(
      "INSERT INTO conversations (bot_id) VALUES ('assistant') RETURNING id",
    );
    await query(
      'INSERT INTO conversation_participants (conversation_id, account_id) VALUES ($1,$2)',
      [bc[0]!.id, aliceId],
    );
    await query(
      "INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,'ask the bot')",
      [bc[0]!.id, aliceId],
    );

    // Build the export directly (the route fires this in the background).
    const { rawToken, filename } = await createExport(aliceId);
    expect(filename).toMatch(/^chatapp-export-\d{4}-\d{2}-\d{2}\.json$/);

    const dl = await app.inject({
      method: 'GET',
      url: `/auth/export/download?token=${encodeURIComponent(rawToken)}`,
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toContain(`filename="${filename}"`);
    const archive = JSON.parse(dl.body);
    expect(archive.profile.username).toBe('alice');
    expect(archive.conversations).toHaveLength(2);
    const contents = archive.conversations.flatMap((c: { messages: { content: string }[] }) =>
      c.messages.map((m) => m.content),
    );
    expect(contents).toContain('hello from alice');
    expect(contents).toContain('hi from bob');
    expect(contents).toContain('ask the bot');
  });

  it('rejects an unknown download token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/auth/export/download?token=${generateToken().raw}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_token');
  });

  it('rejects an expired download token', async () => {
    await createVerifiedUser();
    const id = await accountIdByUsername();
    const { rawToken } = await createExport(id);
    await query(
      "UPDATE data_exports SET expires_at = now() - interval '1 hour' WHERE account_id = $1",
      [id],
    );
    const res = await app.inject({
      method: 'GET',
      url: `/auth/export/download?token=${encodeURIComponent(rawToken)}`,
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('expired_token');
  });
});

describe('auth rate limiting (§6)', () => {
  const resend = (headers?: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: { email: 'nobody@example.com' },
      ...(headers ? { headers } : {}),
    });

  it('blocks resend past the per-IP limit with 429 rate_limited', async () => {
    for (let i = 0; i < AUTH_LIMITS.resendPerIp.max; i++) {
      expect((await resend()).statusCode).toBe(200);
    }
    const blocked = await resend();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');
  });

  it('keys the per-IP limit by source IP (X-Forwarded-For, trustProxy)', async () => {
    // Distinct email per call so only the per-IP limit (not per-email) is in play.
    const fromDefault = (n: number) =>
      app.inject({
        method: 'POST',
        url: '/auth/verify-email/resend',
        payload: { email: `u${n}@example.com` },
      });
    for (let i = 0; i <= AUTH_LIMITS.resendPerIp.max; i++) await fromDefault(i);
    expect((await fromDefault(99)).statusCode).toBe(429); // default IP exhausted

    // A different forwarded IP has its own fresh per-IP window.
    const other = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: { email: 'fresh@example.com' },
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(other.statusCode).toBe(200);
  });

  it('limits login per account, independent of other usernames', async () => {
    const attempt = (username: string) =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username, password: 'whatever-password' },
      });
    for (let i = 0; i < AUTH_LIMITS.loginPerAccount.max; i++) {
      expect((await attempt('ghost')).statusCode).toBe(401); // unknown user
    }
    const blocked = await attempt('ghost');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');

    expect((await attempt('phantom')).statusCode).toBe(401); // separate counter
  });
});
