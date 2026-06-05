import type { FastifyBaseLogger } from 'fastify';
import { sweepExpiredSessions } from './sessions.js';

// Periodic cleanup of expired sessions (§7). `touchSession` already rejects rows
// past the 30-day window; this deletes them so the table doesn't grow unbounded
// and dead token hashes don't linger. Started only from the entrypoint
// (index.ts), never from buildApp(), so tests don't spin up a timer.
//
// In-process and per-machine: with multiple machines each runs its own sweep —
// harmless (the DELETE is idempotent), but a single scheduled job is the cleaner
// long-term home, alongside the rate-limit shared-store move.
export const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

type Options = {
  intervalMs?: number;
  // Injectable for tests; defaults to the real DB sweep.
  sweep?: () => Promise<number>;
};

// Sweeps once immediately, then on each interval. Returns a stop function that
// cancels the timer. The timer is unref'd so it never keeps the process alive.
export function startSessionSweeper(
  log: FastifyBaseLogger,
  { intervalMs = SWEEP_INTERVAL_MS, sweep = sweepExpiredSessions }: Options = {},
): () => void {
  const run = async (): Promise<void> => {
    try {
      const deleted = await sweep();
      if (deleted > 0) log.info({ deleted }, 'swept expired sessions');
    } catch (err) {
      log.error(err, 'session sweep failed');
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
