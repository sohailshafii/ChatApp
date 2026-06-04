import type { AccountUser } from '@chatapp/shared';
import { query } from '../db/pool.js';
import { generateToken, hashToken } from './tokens.js';

// Opaque DB-backed sessions (§1 login, §7 lifecycle). The raw token is set on the
// browser as an httpOnly cookie; only its sha256 hash is persisted, so the token
// table is useless to an attacker who only reads the database.

// 30-day sliding expiry: a session is valid while last_active_at is within the
// window, and every authenticated request pushes the window forward (§7). A
// background sweeper (future) deletes rows past the window.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

// Columns selected when returning the authenticated user (accountUserSchema).
export type AccountRow = {
  id: string;
  username: string;
  email: string;
  verified: boolean;
  created_at: Date;
};

export function toAccountUser(row: AccountRow): AccountUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    verified: row.verified,
    createdAt: row.created_at.toISOString(),
  };
}

// Creates a session for an account and returns the raw token to set as a cookie.
export async function createSession(accountId: string): Promise<string> {
  const token = generateToken();
  await query('INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)', [
    token.hash,
    accountId,
  ]);
  return token.raw;
}

// Validates a raw session token. If the session is live, slides its expiry
// (bumps last_active_at) and returns the account; otherwise returns null. The
// update + account fetch happen in one round trip.
export async function touchSession(
  rawToken: string,
): Promise<AccountUser | null> {
  const { rows } = await query<AccountRow>(
    `WITH live AS (
       UPDATE sessions
          SET last_active_at = now()
        WHERE token_hash = $1
          AND last_active_at > now() - ($2 || ' milliseconds')::interval
        RETURNING account_id
     )
     SELECT a.id, a.username, a.email, a.verified, a.created_at
       FROM accounts a
       JOIN live ON live.account_id = a.id`,
    [hashToken(rawToken), String(SESSION_TTL_MS)],
  );
  return rows[0] ? toAccountUser(rows[0]) : null;
}

// Deletes a single session (logout). Idempotent — a missing row is a no-op.
export async function deleteSession(rawToken: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [
    hashToken(rawToken),
  ]);
}
