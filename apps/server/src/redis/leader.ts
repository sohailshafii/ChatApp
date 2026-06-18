import type { Redis } from 'ioredis';
import { appLog } from '../log.js';
import { getRedis } from './client.js';
import { MACHINE_ID } from '../ws/presence.js';

// Periodic-job leadership (multi-machine scale-out, phase 5 — docs/multi-machine.md).
// The retention sweeper and export worker are started on every machine; with N>1
// they'd each run N times. They're safe under concurrency (idempotent deletes;
// export claims rows FOR UPDATE SKIP LOCKED) — just wasteful — so a leader lock is
// an optimization, not a correctness fix.
//
// Without Redis (N=1) every tick runs: there's only one machine. With Redis, a
// per-job lock grants the tick to a single machine; the holder renews it each tick,
// and if it dies the lock expires so another machine takes over within ~the TTL.

// Atomic acquire-or-renew: grant (and (re)set the TTL) iff the lock is free or
// already ours. Avoids the get-then-expire race a non-atomic version would have.
const ACQUIRE_OR_RENEW = `
local holder = redis.call('GET', KEYS[1])
if holder == false or holder == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0`;

// Core acquire-or-renew against an explicit client/machine id (testable seam).
export async function tryAcquireLock(
  redis: Redis,
  name: string,
  machineId: string,
  ttlMs: number,
): Promise<boolean> {
  const got = await redis.eval(
    ACQUIRE_OR_RENEW,
    1,
    `joblock:${name}`,
    machineId,
    String(ttlMs),
  );
  return got === 1;
}

// May this machine run the named periodic job this tick? Pass a TTL comfortably
// larger than the job's interval (e.g. 2×) so the holder keeps leadership between
// ticks. Without Redis (N=1) always true. Fail-open (run) on a Redis error — the
// jobs are idempotent, so the worst case is the pre-Redis "every machine runs".
export async function shouldRunJob(name: string, ttlMs: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return true;
  try {
    return await tryAcquireLock(r, name, MACHINE_ID, ttlMs);
  } catch (err) {
    appLog().error({ err, job: name }, 'job leader check failed; running anyway');
    return true;
  }
}
