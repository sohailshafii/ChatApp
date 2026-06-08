import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  signupRequestSchema,
  loginRequestSchema,
  verifyEmailRequestSchema,
  resendVerificationRequestSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  deleteAccountRequestSchema,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  type LoginResponse,
  type MeResponse,
} from '@chatapp/shared';
import { getPool, query } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import {
  generateToken,
  hashToken,
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
} from '../auth/tokens.js';
import {
  createSession,
  deleteSession,
  touchSession,
  toAccountUser,
  SESSION_TTL_SECONDS,
  type AccountRow,
} from '../auth/sessions.js';
import { generateCsrfToken, csrfTokensMatch } from '../auth/csrf.js';
import { sendVerificationEmail } from '../mail/verification.js';
import { sendPasswordResetEmail } from '../mail/password-reset.js';
import { sendError } from '../http/errors.js';
import {
  rateLimited,
  AUTH_LIMITS,
  ipKey,
  accountKey,
} from '../rate-limit/auth-rate-limit.js';
import { recordAuthEvent } from '../auth/audit.js';
import { deleteAccount } from '../auth/account.js';
import { enqueueExport } from '../auth/data-export.js';
import { hub } from '../ws/hub.js';
import { loadConfig } from '../config.js';

// Postgres unique-violation error code.
const PG_UNIQUE_VIOLATION = '23505';

export function registerAuthRoutes(app: FastifyInstance): void {
  const { cookieSecure } = loadConfig();

  // Session cookie (§6): httpOnly + Secure + SameSite=Lax. The CSRF cookie is
  // identical but readable by client JS so it can be echoed in the header
  // (double-submit). maxAge matches the session sliding window (§7).
  const sessionCookieOptions = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  } as const;
  const csrfCookieOptions = { ...sessionCookieOptions, httpOnly: false };

  function clearAuthCookies(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
  }

  // POST /auth/signup (§1). Creates an unverified account and dispatches a
  // 24h email-verification link. Success is 200 with an empty body so the
  // response does not reveal whether the email already existed beyond the
  // explicit taken-code paths below.
  app.post('/auth/signup', async (request, reply) => {
    const parsed = signupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        'validation_error',
        parsed.error.issues[0]?.message ?? 'Invalid signup request',
      );
    }
    const { username, email, password } = parsed.data;

    if (
      rateLimited(reply, [
        { key: ipKey('signup', request.ip), rule: AUTH_LIMITS.signupPerIp },
      ])
    ) {
      return reply;
    }

    // Hash before opening a transaction — argon2 is ~250ms and shouldn't hold a
    // DB connection. Persist the account and its verification token atomically.
    const passwordHash = await hashPassword(password);
    const token = generateToken();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO accounts (username, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [username, email, passwordHash],
      );
      const accountId = inserted.rows[0]!.id;

      await client.query(
        `INSERT INTO email_verification_tokens (token_hash, account_id, expires_at)
         VALUES ($1, $2, $3)`,
        [token.hash, accountId, expiresAt],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});

      const taken = uniqueViolationField(err);
      if (taken === 'username') {
        return sendError(reply, 'username_taken', 'That username is taken');
      }
      if (taken === 'email') {
        return sendError(
          reply,
          'email_taken',
          'An account with that email already exists',
        );
      }

      request.log.error({ err }, 'signup failed');
      return sendError(reply, 'internal_error', 'Could not create account');
    } finally {
      client.release();
    }

    // Email dispatch is best-effort and must not fail the signup: the account
    // exists and the user can request a resend (§1).
    try {
      await sendVerificationEmail(request.log, email, token.raw);
    } catch (err) {
      request.log.error({ err }, 'verification email dispatch failed');
    }

    return reply.code(200).send();
  });

  // POST /auth/login (§1). Username + password. On success issues an opaque
  // session and sets the session + CSRF cookies, returning the account.
  app.post('/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        'validation_error',
        parsed.error.issues[0]?.message ?? 'Invalid login request',
      );
    }
    const { username, password } = parsed.data;

    if (
      rateLimited(reply, [
        { key: ipKey('login', request.ip), rule: AUTH_LIMITS.loginPerIp },
        {
          key: accountKey('login', username),
          rule: AUTH_LIMITS.loginPerAccount,
        },
      ])
    ) {
      return reply;
    }

    const { rows } = await query<AccountRow & { password_hash: string }>(
      `SELECT id, username, email, verified, created_at, password_hash
         FROM accounts
        WHERE username = $1`,
      [username],
    );
    const account = rows[0];

    // Generic error whether the username is unknown or the password is wrong, so
    // the response does not reveal which usernames exist (§1).
    if (!account || !(await verifyPassword(account.password_hash, password))) {
      // account is set for a wrong password, undefined for an unknown username.
      await recordAuthEvent(request.log, 'login_failure', {
        accountId: account?.id ?? null,
        ip: request.ip,
      });
      return sendError(
        reply,
        'invalid_credentials',
        'Incorrect username or password',
      );
    }

    // Only reveal the unverified state to a caller who proved the password —
    // otherwise it would leak account existence (§1: unverified can't log in).
    if (!account.verified) {
      await recordAuthEvent(request.log, 'login_failure', {
        accountId: account.id,
        ip: request.ip,
      });
      return sendError(
        reply,
        'unverified',
        'Please verify your email before logging in',
      );
    }

    const sessionToken = await createSession(account.id);
    reply.setCookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions);
    reply.setCookie(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions);
    await recordAuthEvent(request.log, 'login', {
      accountId: account.id,
      ip: request.ip,
    });

    const body: LoginResponse = { user: toAccountUser(account) };
    return reply.code(200).send(body);
  });

  // GET /auth/me (§1). Returns the authenticated user, or 401. Each call slides
  // the session's expiry (§7).
  app.get('/auth/me', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) {
      return sendError(reply, 'unauthorized', 'Not authenticated');
    }
    const user = await touchSession(token);
    if (!user) {
      // Stale/expired cookie — clear it so the browser stops sending it.
      clearAuthCookies(reply);
      return sendError(reply, 'unauthorized', 'Not authenticated');
    }
    const body: MeResponse = { user };
    return reply.code(200).send(body);
  });

  // POST /auth/logout (§1, §7). Deletes the current session and clears cookies.
  // State-changing, so it requires the double-submit CSRF token (§6).
  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) {
      return sendError(reply, 'unauthorized', 'Not authenticated');
    }
    if (
      !csrfTokensMatch(
        request.cookies[CSRF_COOKIE_NAME],
        request.headers[CSRF_HEADER_NAME.toLowerCase()],
      )
    ) {
      return sendError(reply, 'csrf_failure', 'CSRF token missing or invalid');
    }

    await deleteSession(token);
    clearAuthCookies(reply);
    return reply.code(204).send();
  });

  // DELETE /auth/account (§6). Re-authenticates with the password, then performs
  // an immediate hard delete: bot conversations are removed, human-conversation
  // messages are retained (the peer then sees "Deleted user"), and sessions +
  // tokens go with the account row. State-changing → double-submit CSRF required.
  app.delete('/auth/account', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) {
      return sendError(reply, 'unauthorized', 'Not authenticated');
    }
    if (
      !csrfTokensMatch(
        request.cookies[CSRF_COOKIE_NAME],
        request.headers[CSRF_HEADER_NAME.toLowerCase()],
      )
    ) {
      return sendError(reply, 'csrf_failure', 'CSRF token missing or invalid');
    }
    const user = await touchSession(token);
    if (!user) {
      clearAuthCookies(reply);
      return sendError(reply, 'unauthorized', 'Not authenticated');
    }

    const parsed = deleteAccountRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        'validation_error',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }

    // Re-authenticate with the current password (§6 confirmation).
    const { rows } = await query<{ password_hash: string }>(
      'SELECT password_hash FROM accounts WHERE id = $1',
      [user.id],
    );
    const hash = rows[0]?.password_hash;
    if (!hash || !(await verifyPassword(hash, parsed.data.password))) {
      return sendError(reply, 'invalid_credentials', 'Incorrect password');
    }

    // Record the event BEFORE the delete so its FK is valid; auth_audit_log's
    // account_id then SET-NULLs as the account row is removed (audit outlives it).
    await recordAuthEvent(request.log, 'account_deletion', {
      accountId: user.id,
      ip: request.ip,
    });
    await deleteAccount(user.id);

    // Best-effort: drop the account's live sockets (its sessions are already
    // gone, so they could not re-authenticate anyway).
    for (const socket of hub.socketsForAccount(user.id)) {
      socket.close();
    }

    clearAuthCookies(reply);
    return reply.code(200).send();
  });

  // POST /auth/export (§6). Kicks off an async export of the caller's data and
  // emails a time-limited download link when ready. Session + CSRF; responds 200
  // immediately and identically whether or not an export is already in flight
  // (no state leak). Rate-limited.
  app.post('/auth/export', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) {
      return sendError(reply, 'unauthorized', 'Not authenticated');
    }
    if (
      !csrfTokensMatch(
        request.cookies[CSRF_COOKIE_NAME],
        request.headers[CSRF_HEADER_NAME.toLowerCase()],
      )
    ) {
      return sendError(reply, 'csrf_failure', 'CSRF token missing or invalid');
    }
    const user = await touchSession(token);
    if (!user) {
      clearAuthCookies(reply);
      return sendError(reply, 'unauthorized', 'Not authenticated');
    }

    if (
      rateLimited(reply, [
        { key: ipKey('export', request.ip), rule: AUTH_LIMITS.exportPerIp },
        {
          key: accountKey('export', user.id),
          rule: AUTH_LIMITS.exportPerAccount,
        },
      ])
    ) {
      return reply;
    }

    await recordAuthEvent(request.log, 'data_export_requested', {
      accountId: user.id,
      ip: request.ip,
    });
    // Durably enqueue the job (committed before the 200); the export worker
    // generates it and emails the link (§6 async).
    await enqueueExport(user.id);
    return reply.code(200).send();
  });

  // GET /auth/export/download?token=… (§6). Serves a generated export by its
  // opaque token (the bearer capability from the emailed link) — no session, so
  // it works in any browser. The archive streams as a file attachment.
  app.get('/auth/export/download', async (request, reply) => {
    const raw = (request.query as { token?: string }).token;
    if (!raw) {
      return sendError(reply, 'validation_error', 'Missing export token');
    }
    const { rows } = await query<{
      content: Buffer;
      filename: string;
      expires_at: Date;
    }>(
      `SELECT content, filename, expires_at FROM data_exports
        WHERE token_hash = $1 AND status = 'ready'`,
      [hashToken(raw)],
    );
    const row = rows[0];
    if (!row) {
      return sendError(reply, 'invalid_token', 'This export link is invalid');
    }
    if (row.expires_at.getTime() <= Date.now()) {
      return sendError(reply, 'expired_token', 'This export link has expired');
    }
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${row.filename}"`)
      .send(row.content);
  });

  // POST /auth/verify-email (§1). Consumes a verification token, marks the
  // account verified, and invalidates the account's remaining tokens.
  app.post('/auth/verify-email', async (request, reply) => {
    const parsed = verifyEmailRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        'validation_error',
        parsed.error.issues[0]?.message ?? 'Invalid verification request',
      );
    }
    const tokenHash = hashToken(parsed.data.token);

    const { rows } = await query<{ account_id: string; expires_at: Date }>(
      `SELECT account_id, expires_at
         FROM email_verification_tokens
        WHERE token_hash = $1`,
      [tokenHash],
    );
    const record = rows[0];
    if (!record) {
      return sendError(reply, 'invalid_token', 'This verification link is invalid');
    }
    if (record.expires_at.getTime() <= Date.now()) {
      // Prune the dead token; the user must request a fresh link.
      await query('DELETE FROM email_verification_tokens WHERE token_hash = $1', [
        tokenHash,
      ]);
      return sendError(
        reply,
        'expired_token',
        'This verification link has expired; request a new one',
      );
    }

    // Mark verified and consume all of the account's verification tokens
    // atomically — once verified, any outstanding links are moot.
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE accounts SET verified = true WHERE id = $1', [
        record.account_id,
      ]);
      await client.query(
        'DELETE FROM email_verification_tokens WHERE account_id = $1',
        [record.account_id],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err }, 'email verification failed');
      return sendError(reply, 'internal_error', 'Could not verify email');
    } finally {
      client.release();
    }

    return reply.code(200).send();
  });

  // POST /auth/verify-email/resend (§1). Re-issues a verification link. Always
  // 200 with an empty body — it never reveals whether the email is registered
  // or already verified (anti-enumeration). Note: this is an email-spam vector,
  // so it must get rate limiting when that primitive lands (§6).
  app.post('/auth/verify-email/resend', async (request, reply) => {
    const parsed = resendVerificationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        'validation_error',
        parsed.error.issues[0]?.message ?? 'Invalid resend request',
      );
    }
    const { email } = parsed.data;

    if (
      rateLimited(reply, [
        { key: ipKey('verify-resend', request.ip), rule: AUTH_LIMITS.resendPerIp },
        {
          key: accountKey('verify-resend', email),
          rule: AUTH_LIMITS.resendPerAccount,
        },
      ])
    ) {
      return reply;
    }

    const { rows } = await query<{ id: string; verified: boolean }>(
      'SELECT id, verified FROM accounts WHERE email = $1',
      [email],
    );
    const account = rows[0];

    // Only do real work for an existing, still-unverified account; otherwise
    // fall through to the same generic 200.
    if (account && !account.verified) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

      let stored = false;
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        // Replace outstanding tokens so only the newest link works.
        await client.query(
          'DELETE FROM email_verification_tokens WHERE account_id = $1',
          [account.id],
        );
        await client.query(
          `INSERT INTO email_verification_tokens (token_hash, account_id, expires_at)
           VALUES ($1, $2, $3)`,
          [token.hash, account.id, expiresAt],
        );
        await client.query('COMMIT');
        stored = true;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        request.log.error({ err }, 'verification resend failed');
      } finally {
        client.release();
      }

      if (stored) {
        try {
          await sendVerificationEmail(request.log, email, token.raw);
        } catch (err) {
          request.log.error({ err }, 'verification email dispatch failed');
        }
      }
    }

    return reply.code(200).send();
  });

  // POST /auth/password-reset/request (§1). Accepts a username OR email and sends
  // a 1h reset link to the account's email. Always 200 with an empty body so it
  // never reveals whether the identifier matched an account (anti-enumeration).
  // Needs rate limiting when that primitive lands (§6).
  app.post('/auth/password-reset/request', async (request, reply) => {
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        'validation_error',
        parsed.error.issues[0]?.message ?? 'Invalid reset request',
      );
    }
    const { identifier } = parsed.data;

    if (
      rateLimited(reply, [
        { key: ipKey('reset', request.ip), rule: AUTH_LIMITS.resetPerIp },
        {
          key: accountKey('reset', identifier),
          rule: AUTH_LIMITS.resetPerAccount,
        },
      ])
    ) {
      return reply;
    }

    // citext columns -> case-insensitive match on either username or email.
    const { rows } = await query<{ id: string; email: string }>(
      'SELECT id, email FROM accounts WHERE username = $1 OR email = $1',
      [identifier],
    );
    const account = rows[0];

    if (account) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

      let stored = false;
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        // Replace outstanding reset tokens so only the newest link works.
        await client.query(
          'DELETE FROM password_reset_tokens WHERE account_id = $1',
          [account.id],
        );
        await client.query(
          `INSERT INTO password_reset_tokens (token_hash, account_id, expires_at)
           VALUES ($1, $2, $3)`,
          [token.hash, account.id, expiresAt],
        );
        await client.query('COMMIT');
        stored = true;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        request.log.error({ err }, 'password-reset request failed');
      } finally {
        client.release();
      }

      if (stored) {
        try {
          await sendPasswordResetEmail(request.log, account.email, token.raw);
        } catch (err) {
          request.log.error({ err }, 'password-reset email dispatch failed');
        }
      }
    }

    return reply.code(200).send();
  });

  // POST /auth/password-reset/confirm (§1). Sets a new password from a valid reset
  // token and invalidates ALL of the account's sessions ("log out everywhere").
  app.post('/auth/password-reset/confirm', async (request, reply) => {
    const parsed = passwordResetConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        'validation_error',
        parsed.error.issues[0]?.message ?? 'Invalid reset request',
      );
    }
    const { token, newPassword } = parsed.data;
    const tokenHash = hashToken(token);

    const { rows } = await query<{ account_id: string; expires_at: Date }>(
      `SELECT account_id, expires_at
         FROM password_reset_tokens
        WHERE token_hash = $1`,
      [tokenHash],
    );
    const record = rows[0];
    if (!record) {
      return sendError(reply, 'invalid_token', 'This reset link is invalid');
    }
    if (record.expires_at.getTime() <= Date.now()) {
      await query('DELETE FROM password_reset_tokens WHERE token_hash = $1', [
        tokenHash,
      ]);
      return sendError(
        reply,
        'expired_token',
        'This reset link has expired; request a new one',
      );
    }

    // Hash outside the transaction (argon2 is ~250ms). Then set the password,
    // drop every session for the account (§1), and consume the reset tokens.
    const passwordHash = await hashPassword(newPassword);
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE accounts SET password_hash = $1 WHERE id = $2',
        [passwordHash, record.account_id],
      );
      await client.query('DELETE FROM sessions WHERE account_id = $1', [
        record.account_id,
      ]);
      await client.query(
        'DELETE FROM password_reset_tokens WHERE account_id = $1',
        [record.account_id],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err }, 'password-reset confirm failed');
      return sendError(reply, 'internal_error', 'Could not reset password');
    } finally {
      client.release();
    }

    await recordAuthEvent(request.log, 'password_reset', {
      accountId: record.account_id,
      ip: request.ip,
    });

    return reply.code(200).send();
  });
}

// Distinguishes which UNIQUE constraint a pg error tripped, so we can return the
// precise taken-code. Postgres auto-names the column constraints
// `accounts_username_key` / `accounts_email_key`.
function uniqueViolationField(err: unknown): 'username' | 'email' | null {
  if (
    typeof err !== 'object' ||
    err === null ||
    (err as { code?: unknown }).code !== PG_UNIQUE_VIOLATION
  ) {
    return null;
  }
  const constraint = String((err as { constraint?: unknown }).constraint ?? '');
  if (constraint.includes('username')) return 'username';
  if (constraint.includes('email')) return 'email';
  return null;
}
