import type { FastifyBaseLogger } from 'fastify';
import { query } from '../db/pool.js';

// Per-account auth event log (§6), table auth_audit_log (migration 008). Exists
// from v1 so a "recent activity" view can be surfaced later. `login`,
// `login_failure`, and `password_reset` are wired now; the rest are reserved
// until their endpoints land (account deletion, push subscription endpoints).
export type AuthEvent =
  | 'login'
  | 'login_failure'
  | 'password_reset'
  | 'account_deletion'
  | 'push_subscription_added'
  | 'push_subscription_removed';

type AuthEventContext = {
  // Null when the event isn't tied to a known account (e.g. a login attempt for
  // an unknown username).
  accountId?: string | null;
  ip?: string | null;
};

// Records an auth event. Best-effort: a failed insert is logged but never thrown,
// so auditing can't break the auth action it accompanies. Awaited by callers so
// the write is ordered before the response (the insert is a single indexed row;
// argon2 already dominates auth latency).
export async function recordAuthEvent(
  log: FastifyBaseLogger,
  event: AuthEvent,
  { accountId = null, ip = null }: AuthEventContext = {},
): Promise<void> {
  try {
    await query(
      'INSERT INTO auth_audit_log (account_id, event, ip) VALUES ($1, $2, $3)',
      [accountId, event, ip],
    );
  } catch (err) {
    log.error({ err, event }, 'failed to record auth audit event');
  }
}
