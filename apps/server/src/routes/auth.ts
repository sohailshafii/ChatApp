import type { FastifyInstance } from 'fastify';
import { signupRequestSchema } from '@chatapp/shared';
import { getPool } from '../db/pool.js';
import { hashPassword } from '../auth/passwords.js';
import {
  generateToken,
  EMAIL_VERIFICATION_TTL_MS,
} from '../auth/tokens.js';
import { sendVerificationEmail } from '../mail/verification.js';
import { sendError } from '../http/errors.js';

// Postgres unique-violation error code.
const PG_UNIQUE_VIOLATION = '23505';

export function registerAuthRoutes(app: FastifyInstance): void {
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
