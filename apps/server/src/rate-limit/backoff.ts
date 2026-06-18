// Failure-driven exponential backoff (§6) — the companion to the fixed-window
// `RateLimiter`. Where the limiter caps request *volume* over a window, this caps
// *repeated failures* against a single key (e.g. one account's login) by locking
// it out for a duration that doubles with each consecutive failure, and clears the
// moment the caller succeeds. That's the "exponential backoff on repeated failure"
// §6 asks of the auth endpoints: an attacker grinding one credential is slowed
// geometrically, while an honest user who fat-fingers a few times then logs in is
// untouched (success resets the counter).
//
// Two interchangeable backends behind one async interface (createFailureBackoff
// picks by REDIS_URL), mirroring the RateLimiter: a per-process Map (default,
// single-machine) or a Redis hash with a Lua read-modify-write (shared across the
// fleet). See docs/multi-machine.md.

import type { Redis } from 'ioredis';
import { loadConfig } from '../config.js';
import { appLog } from '../log.js';
import { getRedis } from '../redis/client.js';

export type BackoffRule = {
  // Consecutive failures allowed with NO lockout before backoff engages — room for
  // honest typos. The (freeRetries + 1)-th failure is the first to lock.
  freeRetries: number;
  // Lockout for the first penalized failure; doubles each subsequent failure.
  baseMs: number;
  // Ceiling on the lockout duration (the doubling saturates here).
  maxMs: number;
};

export interface FailureBackoff {
  retryAfter(key: string, rule: BackoffRule, now?: number): Promise<number>;
  recordFailure(key: string, rule: BackoffRule, now?: number): Promise<number>;
  recordSuccess(key: string): Promise<void>;
  reset(): void | Promise<void>;
}

// Shared pure helper: the lockout for the n-th consecutive failure.
function lockMsFor(failures: number, rule: BackoffRule): number {
  const penalized = failures - rule.freeRetries;
  return penalized <= 0
    ? 0
    : Math.min(rule.baseMs * 2 ** (penalized - 1), rule.maxMs);
}

type State = { failures: number; lockedUntil: number };

export class InMemoryFailureBackoff implements FailureBackoff {
  private readonly states = new Map<string, State>();

  // Milliseconds the caller must wait before this key is allowed again — 0 when
  // it's free to proceed. Read-only: it neither counts nor extends anything.
  async retryAfter(
    key: string,
    _rule: BackoffRule,
    now: number = Date.now(),
  ): Promise<number> {
    const state = this.states.get(key);
    if (!state) return 0;
    return Math.max(0, state.lockedUntil - now);
  }

  // Records a failure for `key` and returns the resulting lockout in ms (0 while
  // still within the free-retry grace).
  async recordFailure(
    key: string,
    rule: BackoffRule,
    now: number = Date.now(),
  ): Promise<number> {
    const failures = (this.states.get(key)?.failures ?? 0) + 1;
    const lockMs = lockMsFor(failures, rule);
    this.states.set(key, { failures, lockedUntil: now + lockMs });
    return lockMs;
  }

  // Clears the failure streak for `key` — call on a successful attempt.
  async recordSuccess(key: string): Promise<void> {
    this.states.delete(key);
  }

  reset(): void {
    this.states.clear();
  }
}

// Read-modify-write of {failures, lockedUntil} in one atomic step, and refresh the
// key's TTL so an abandoned streak decays on its own (max lockout after the last
// failure). Returns the lockout ms as a string (Lua numbers are floats; we floor).
const RECORD_FAILURE = `
local failures = redis.call('HINCRBY', KEYS[1], 'failures', 1)
local penalized = failures - tonumber(ARGV[1])
local lockMs = 0
if penalized > 0 then
  lockMs = tonumber(ARGV[2]) * (2 ^ (penalized - 1))
  local maxMs = tonumber(ARGV[3])
  if lockMs > maxMs then lockMs = maxMs end
end
local lockedUntil = tonumber(ARGV[4]) + lockMs
redis.call('HSET', KEYS[1], 'lockedUntil', lockedUntil)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return tostring(math.floor(lockMs))`;

export class RedisFailureBackoff implements FailureBackoff {
  constructor(private readonly redis: () => Redis | null = getRedis) {}

  async retryAfter(
    key: string,
    _rule: BackoffRule,
    now: number = Date.now(),
  ): Promise<number> {
    const r = this.redis();
    if (!r) return 0; // fail open
    try {
      const lockedUntil = await r.hget(`bo:${key}`, 'lockedUntil');
      if (!lockedUntil) return 0;
      return Math.max(0, Number(lockedUntil) - now);
    } catch (err) {
      appLog().error({ err, key }, 'redis backoff read failed; allowing');
      return 0;
    }
  }

  async recordFailure(
    key: string,
    rule: BackoffRule,
    now: number = Date.now(),
  ): Promise<number> {
    const r = this.redis();
    if (!r) return 0;
    try {
      const lockMs = (await r.eval(
        RECORD_FAILURE,
        1,
        `bo:${key}`,
        String(rule.freeRetries),
        String(rule.baseMs),
        String(rule.maxMs),
        String(now),
      )) as string;
      return Number(lockMs);
    } catch (err) {
      appLog().error({ err, key }, 'redis backoff record failed');
      return 0;
    }
  }

  async recordSuccess(key: string): Promise<void> {
    const r = this.redis();
    if (!r) return;
    try {
      await r.del(`bo:${key}`);
    } catch (err) {
      appLog().error({ err, key }, 'redis backoff clear failed');
    }
  }

  reset(): void {}
}

export function createFailureBackoff(): FailureBackoff {
  return loadConfig().redisConfigured
    ? new RedisFailureBackoff()
    : new InMemoryFailureBackoff();
}
