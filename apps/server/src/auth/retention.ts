import type { FastifyBaseLogger } from 'fastify';
import { sweepExpiredSessions } from './sessions.js';
import { sweepExpiredDataExports } from './data-export.js';
import { sweepOldAuditEvents } from './audit.js';

// Periodic retention cleanup (§6/§7) — the "delete" half of every expiry policy.
// Each task prunes one table whose rows the rest of the app already treats as
// dead past their window:
//   - expired sessions (past the 30-day sliding window; touchSession rejects them)
//   - expired data exports (past the 24h download link; PII at rest)
//   - old audit events (past AUDIT_RETENTION_DAYS, ~180d)
//
// Started only from the entrypoint (index.ts), never from buildApp(), so tests
// don't spin up a timer. In-process and per-machine: each machine runs its own
// sweep — harmless (the DELETEs are idempotent), but a single scheduled job is
// the cleaner long-term home, alongside the rate-limit shared-store / hub→pub-sub
// moves.
export const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export type SweepTask = { name: string; sweep: () => Promise<number> };

export const RETENTION_TASKS: readonly SweepTask[] = [
  { name: 'sessions', sweep: sweepExpiredSessions },
  { name: 'data_exports', sweep: sweepExpiredDataExports },
  { name: 'auth_audit_log', sweep: sweepOldAuditEvents },
];

type Options = {
  intervalMs?: number;
  tasks?: readonly SweepTask[];
};

// Runs every task once immediately, then on each interval. A task failing is
// logged and does not stop the others. Returns a stop function; the timer is
// unref'd so it never keeps the process alive.
export function startRetentionSweeper(
  log: FastifyBaseLogger,
  { intervalMs = RETENTION_SWEEP_INTERVAL_MS, tasks = RETENTION_TASKS }: Options = {},
): () => void {
  const run = async (): Promise<void> => {
    for (const { name, sweep } of tasks) {
      try {
        const deleted = await sweep();
        if (deleted > 0) log.info({ deleted, table: name }, 'retention sweep');
      } catch (err) {
        log.error({ err, table: name }, 'retention sweep failed');
      }
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
