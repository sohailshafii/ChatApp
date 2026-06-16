import type pg from 'pg';
import { query } from '../db/pool.js';
import { loadConfig } from '../config.js';

// Email-bound signup invitations (§1 access gating). When invite-only mode is
// on, POST /auth/signup requires an *open* invite (unaccepted, unexpired) whose
// email matches. Operators mint invites with `npm run invite`; the email match
// is the gate (email verification still proves the recipient owns the address).

export const INVITE_TTL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Test seam (same pattern as setMailSender / setBotProvider / setPushSender):
// override the config flag so the signup gate can be exercised both ways without
// rebuilding the cached config. Undefined → fall back to the loaded config.
let inviteOnlyOverride: boolean | undefined;
export function isInviteOnly(): boolean {
  return inviteOnlyOverride ?? loadConfig().inviteOnly;
}
export function setInviteOnly(value: boolean | undefined): void {
  inviteOnlyOverride = value;
}

// Operator-minted invite for an email address. Idempotent per email: re-inviting
// an address refreshes its expiry and re-opens it (clears any prior acceptance),
// so a stale or already-used invite can simply be re-issued.
export async function createInvite(
  email: string,
  ttlDays: number = INVITE_TTL_DAYS,
): Promise<{ email: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ttlDays * DAY_MS);
  const { rows } = await query<{ email: string; expires_at: Date }>(
    `INSERT INTO invites (email, expires_at)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
       SET expires_at = EXCLUDED.expires_at,
           created_at = now(),
           accepted_at = NULL,
           accepted_account_id = NULL
     RETURNING email, expires_at`,
    [email, expiresAt],
  );
  const row = rows[0]!;
  return { email: row.email, expiresAt: row.expires_at };
}

// Fast pre-check used before the (expensive) password hash: is there an open
// invite for this email? The consume below re-checks atomically inside the txn.
export async function hasPendingInvite(email: string): Promise<boolean> {
  const { rowCount } = await query(
    `SELECT 1 FROM invites
      WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [email],
  );
  return (rowCount ?? 0) > 0;
}

// Atomically claim an open invite inside the signup transaction. Returns true if
// one was consumed; false means none was open (e.g. a concurrent signup claimed
// it first), in which case the caller should roll back and reject.
export async function consumeInvite(
  client: pg.PoolClient,
  email: string,
  accountId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE invites
        SET accepted_at = now(), accepted_account_id = $2
      WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [email, accountId],
  );
  return (rowCount ?? 0) > 0;
}

// Retention (§6/§7): drop invites the app already treats as dead — expired
// unaccepted ones, and accepted ones older than 30 days (kept briefly for audit
// of who joined, then pruned). Wired into the retention sweeper.
export async function sweepExpiredInvites(): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM invites
      WHERE (accepted_at IS NULL AND expires_at < now())
         OR (accepted_at IS NOT NULL AND accepted_at < now() - interval '30 days')`,
  );
  return rowCount ?? 0;
}
