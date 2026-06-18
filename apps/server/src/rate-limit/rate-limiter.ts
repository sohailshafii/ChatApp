// Fixed-window rate limiter — the single primitive shared across auth endpoints,
// bot invocation, message send, and username lookup (§6).
//
// Two interchangeable backends behind one async interface (createRateLimiter
// picks by REDIS_URL):
//
//   - In-memory (default, REDIS_URL unset): a per-process Map. Correct only on a
//     single machine — which is the v1 deployment (N=1). See docs/multi-machine.md.
//   - Redis (REDIS_URL set): an atomic INCR + per-window expiry in a shared store,
//     so the cap is a TRUE global (whole-fleet) cap across machines. This is what
//     unblocks running N>1.
//
// The caps in AUTH_LIMITS/BOT_LIMITS/etc. are therefore exact global numbers — the
// old `perMachineMax` division (a stopgap for the in-memory backend at N>1) is
// gone, because we only ever run N>1 with the Redis backend.

import type { Redis } from 'ioredis';
import { loadConfig } from '../config.js';
import { appLog } from '../log.js';
import { getRedis } from '../redis/client.js';

export type RateLimitRule = {
  // Maximum allowed hits per key within the window.
  max: number;
  // Window length in milliseconds.
  windowMs: number;
};

// Async so the Redis-backed backend can do its round trip; the in-memory backend
// just resolves immediately. `now` stays injectable for deterministic in-memory
// tests (the Redis backend keys windows off its own TTL and ignores it).
export interface RateLimiter {
  check(key: string, rule: RateLimitRule, now?: number): Promise<boolean>;
  // Test/maintenance helper. In-memory clears its Map; Redis is a no-op (the
  // Redis-backed tests manage their own keyspace). Hence the union return.
  reset(): void | Promise<void>;
}

type Window = { count: number; resetAt: number };

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();

  // Records a hit for `key` and resolves true if it is within the limit, false if
  // the key has exhausted its allowance for the current window.
  async check(
    key: string,
    rule: RateLimitRule,
    now: number = Date.now(),
  ): Promise<boolean> {
    const existing = this.windows.get(key);
    if (!existing || now >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return true;
    }
    if (existing.count >= rule.max) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  reset(): void {
    this.windows.clear();
  }
}

// Atomic "increment, and set the window TTL only on creation". A tiny Lua script
// keeps the INCR and the first PEXPIRE in one round trip so a crash between them
// can't leave a counter without an expiry.
const INCR_WINDOW = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return c`;

export class RedisRateLimiter implements RateLimiter {
  // The client is resolved lazily (it connects at boot, after module load).
  constructor(private readonly redis: () => Redis | null = getRedis) {}

  async check(key: string, rule: RateLimitRule): Promise<boolean> {
    const r = this.redis();
    // Fail open: with no client (misconfig) or a Redis outage, allow the request
    // rather than lock everyone out. The window resets naturally once Redis is back.
    if (!r) return true;
    try {
      const count = (await r.eval(
        INCR_WINDOW,
        1,
        `rl:${key}`,
        String(rule.windowMs),
      )) as number;
      return count <= rule.max;
    } catch (err) {
      appLog().error({ err, key }, 'redis rate-limit check failed; allowing');
      return true;
    }
  }

  // No-op: production never resets, and the Redis-backed tests flush their own DB.
  reset(): void {}
}

// Selects the backend by configuration. Redis when REDIS_URL is set, else the
// in-process Map. Call sites only touch the async interface, so they don't care.
export function createRateLimiter(): RateLimiter {
  return loadConfig().redisConfigured
    ? new RedisRateLimiter()
    : new InMemoryRateLimiter();
}
