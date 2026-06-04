import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  signupRequestSchema,
  loginRequestSchema,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  type LoginResponse,
  type MeResponse,
} from '@chatapp/shared';
import { getPool, query } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { generateToken, EMAIL_VERIFICATION_TTL_MS } from '../auth/tokens.js';
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
import { sendError } from '../http/errors.js';
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
      return sendError(
        reply,
        'invalid_credentials',
        'Incorrect username or password',
      );
    }

    // Only reveal the unverified state to a caller who proved the password —
    // otherwise it would leak account existence (§1: unverified can't log in).
    if (!account.verified) {
      return sendError(
        reply,
        'unverified',
        'Please verify your email before logging in',
      );
    }

    const sessionToken = await createSession(account.id);
    reply.setCookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions);
    reply.setCookie(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions);

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
