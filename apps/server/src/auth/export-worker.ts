import type { FastifyBaseLogger } from 'fastify';
import { processPendingExports } from './data-export.js';
import { shouldRunJob } from '../redis/leader.js';

// Background worker that turns durably-enqueued export jobs (§6) into ready
// archives. Polls for `pending` rows, so a job survives a crash/redeploy: the
// request committed the row, and the worker picks it up (here or on the next
// boot). Started only from the entrypoint (index.ts), never from buildApp(), so
// tests don't spin up a timer. In-process unref'd interval, like the retention
// sweeper.
export const EXPORT_WORKER_INTERVAL_MS = 60 * 1000; // 60s — well within "we'll email you"

type Options = {
  intervalMs?: number;
  // Injectable for tests; defaults to the real DB processor.
  process?: (log: FastifyBaseLogger) => Promise<number>;
};

// Drains pending jobs once immediately, then on each interval. Returns a stop
// function; the timer is unref'd so it never keeps the process alive.
export function startExportWorker(
  log: FastifyBaseLogger,
  { intervalMs = EXPORT_WORKER_INTERVAL_MS, process = processPendingExports }: Options = {},
): () => void {
  const run = async (): Promise<void> => {
    // With Redis, only the leader machine drains jobs this tick (the DB claim is
    // SKIP-LOCKED-safe regardless; this just avoids N machines polling).
    if (!(await shouldRunJob('export-worker', intervalMs * 2))) return;
    try {
      const done = await process(log);
      if (done > 0) log.info({ done }, 'processed export jobs');
    } catch (err) {
      log.error({ err }, 'export worker run failed');
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
