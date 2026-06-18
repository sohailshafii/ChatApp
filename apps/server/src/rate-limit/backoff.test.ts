import { describe, it, expect } from 'vitest';
import { InMemoryFailureBackoff, type BackoffRule } from './backoff.js';

// 2 free failures, then 100ms doubling up to 400ms (so the cap bites quickly).
const rule: BackoffRule = { freeRetries: 2, baseMs: 100, maxMs: 400 };

describe('InMemoryFailureBackoff', () => {
  it('does not lock out within the free-retry grace', async () => {
    const b = new InMemoryFailureBackoff();
    expect(await b.recordFailure('k', rule, 0)).toBe(0); // failure 1
    expect(await b.recordFailure('k', rule, 0)).toBe(0); // failure 2
    expect(await b.retryAfter('k', rule, 0)).toBe(0); // still free
  });

  it('locks out exponentially once the grace is exceeded, capped at maxMs', async () => {
    const b = new InMemoryFailureBackoff();
    await b.recordFailure('k', rule, 0); // 1 (free)
    await b.recordFailure('k', rule, 0); // 2 (free)
    expect(await b.recordFailure('k', rule, 0)).toBe(100); // 3 -> base
    expect(await b.recordFailure('k', rule, 0)).toBe(200); // 4 -> x2
    expect(await b.recordFailure('k', rule, 0)).toBe(400); // 5 -> x4 == cap
    expect(await b.recordFailure('k', rule, 0)).toBe(400); // 6 -> saturated at cap
  });

  it('retryAfter counts down and reaches 0 when the lock elapses', async () => {
    const b = new InMemoryFailureBackoff();
    for (let i = 0; i < 3; i++) await b.recordFailure('k', rule, 0); // locks 100ms at t=0
    expect(await b.retryAfter('k', rule, 0)).toBe(100);
    expect(await b.retryAfter('k', rule, 60)).toBe(40);
    expect(await b.retryAfter('k', rule, 100)).toBe(0);
    expect(await b.retryAfter('k', rule, 150)).toBe(0);
  });

  it('recordSuccess clears the failure streak', async () => {
    const b = new InMemoryFailureBackoff();
    for (let i = 0; i < 3; i++) await b.recordFailure('k', rule, 0); // locked
    expect(await b.retryAfter('k', rule, 0)).toBeGreaterThan(0);
    await b.recordSuccess('k');
    expect(await b.retryAfter('k', rule, 0)).toBe(0);
    // The next failure starts a fresh streak (back in the free grace).
    expect(await b.recordFailure('k', rule, 0)).toBe(0);
  });

  it('tracks keys independently', async () => {
    const b = new InMemoryFailureBackoff();
    for (let i = 0; i < 3; i++) await b.recordFailure('a', rule, 0);
    expect(await b.retryAfter('a', rule, 0)).toBe(100);
    expect(await b.retryAfter('b', rule, 0)).toBe(0); // 'b' untouched
  });

  it('reset() clears all state', async () => {
    const b = new InMemoryFailureBackoff();
    for (let i = 0; i < 3; i++) await b.recordFailure('k', rule, 0);
    b.reset();
    expect(await b.retryAfter('k', rule, 0)).toBe(0);
  });
});
