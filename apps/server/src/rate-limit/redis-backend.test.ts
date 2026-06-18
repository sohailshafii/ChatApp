import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RedisRateLimiter } from './rate-limiter.js';
import { RedisFailureBackoff, type BackoffRule } from './backoff.js';

// Exercises the REAL Redis backends (the Lua scripts the in-memory tests can't
// cover). Skipped unless TEST_REDIS_URL is set, so CI stays Redis-free; run it
// against a throwaway Redis with e.g.
//   docker run --rm -p 6399:6379 redis:7-alpine
//   TEST_REDIS_URL=redis://localhost:6399 npm test -w @chatapp/server -- redis-backend
const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)('Redis rate-limit backends', () => {
  let client: Redis;
  beforeAll(() => {
    client = new Redis(url!);
  });
  afterEach(async () => {
    await client.flushdb();
  });
  afterAll(async () => {
    await client.quit();
  });

  describe('RedisRateLimiter', () => {
    const rule = { max: 3, windowMs: 10_000 };
    it('allows up to max then blocks, globally across instances', async () => {
      // Two limiters sharing one Redis = two machines sharing the global cap.
      const a = new RedisRateLimiter(() => client);
      const b = new RedisRateLimiter(() => client);
      expect(await a.check('k', rule)).toBe(true); // 1
      expect(await b.check('k', rule)).toBe(true); // 2 (other instance)
      expect(await a.check('k', rule)).toBe(true); // 3
      expect(await b.check('k', rule)).toBe(false); // 4 -> over the shared cap
    });

    it('sets a TTL on the window so it expires', async () => {
      const rl = new RedisRateLimiter(() => client);
      await rl.check('k', rule);
      const ttl = await client.pttl('rl:k');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(rule.windowMs);
    });

    it('fails open when the client is absent', async () => {
      const rl = new RedisRateLimiter(() => null);
      expect(await rl.check('k', rule)).toBe(true);
    });
  });

  describe('RedisFailureBackoff', () => {
    const rule: BackoffRule = { freeRetries: 2, baseMs: 100, maxMs: 400 };
    it('locks out exponentially once the grace is exceeded, capped at maxMs', async () => {
      const b = new RedisFailureBackoff(() => client);
      expect(await b.recordFailure('k', rule, 0)).toBe(0); // 1 free
      expect(await b.recordFailure('k', rule, 0)).toBe(0); // 2 free
      expect(await b.recordFailure('k', rule, 0)).toBe(100); // 3 -> base
      expect(await b.recordFailure('k', rule, 0)).toBe(200); // 4 -> x2
      expect(await b.recordFailure('k', rule, 0)).toBe(400); // 5 -> cap
      expect(await b.recordFailure('k', rule, 0)).toBe(400); // 6 -> saturated
    });

    it('retryAfter counts down from the lock and recordSuccess clears it', async () => {
      const b = new RedisFailureBackoff(() => client);
      for (let i = 0; i < 3; i++) await b.recordFailure('k', rule, 0); // locks 100ms at t=0
      expect(await b.retryAfter('k', rule, 0)).toBe(100);
      expect(await b.retryAfter('k', rule, 60)).toBe(40);
      expect(await b.retryAfter('k', rule, 100)).toBe(0);
      await b.recordSuccess('k');
      expect(await b.retryAfter('k', rule, 0)).toBe(0);
      expect(await b.recordFailure('k', rule, 0)).toBe(0); // fresh streak
    });
  });
});
