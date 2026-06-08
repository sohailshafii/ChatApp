import { describe, it, expect } from 'vitest';
import { FailureBackoff, type BackoffRule } from './backoff.js';

// 2 free failures, then 100ms doubling up to 400ms (so the cap bites quickly).
const rule: BackoffRule = { freeRetries: 2, baseMs: 100, maxMs: 400 };

describe('FailureBackoff', () => {
  it('does not lock out within the free-retry grace', () => {
    const b = new FailureBackoff();
    expect(b.recordFailure('k', rule, 0)).toBe(0); // failure 1
    expect(b.recordFailure('k', rule, 0)).toBe(0); // failure 2
    expect(b.retryAfter('k', rule, 0)).toBe(0); // still free
  });

  it('locks out exponentially once the grace is exceeded, capped at maxMs', () => {
    const b = new FailureBackoff();
    b.recordFailure('k', rule, 0); // 1 (free)
    b.recordFailure('k', rule, 0); // 2 (free)
    expect(b.recordFailure('k', rule, 0)).toBe(100); // 3 -> base
    expect(b.recordFailure('k', rule, 0)).toBe(200); // 4 -> x2
    expect(b.recordFailure('k', rule, 0)).toBe(400); // 5 -> x4 == cap
    expect(b.recordFailure('k', rule, 0)).toBe(400); // 6 -> saturated at cap
  });

  it('retryAfter counts down and reaches 0 when the lock elapses', () => {
    const b = new FailureBackoff();
    for (let i = 0; i < 3; i++) b.recordFailure('k', rule, 0); // locks 100ms at t=0
    expect(b.retryAfter('k', rule, 0)).toBe(100);
    expect(b.retryAfter('k', rule, 60)).toBe(40);
    expect(b.retryAfter('k', rule, 100)).toBe(0);
    expect(b.retryAfter('k', rule, 150)).toBe(0);
  });

  it('recordSuccess clears the failure streak', () => {
    const b = new FailureBackoff();
    for (let i = 0; i < 3; i++) b.recordFailure('k', rule, 0); // locked
    expect(b.retryAfter('k', rule, 0)).toBeGreaterThan(0);
    b.recordSuccess('k');
    expect(b.retryAfter('k', rule, 0)).toBe(0);
    // The next failure starts a fresh streak (back in the free grace).
    expect(b.recordFailure('k', rule, 0)).toBe(0);
  });

  it('tracks keys independently', () => {
    const b = new FailureBackoff();
    for (let i = 0; i < 3; i++) b.recordFailure('a', rule, 0);
    expect(b.retryAfter('a', rule, 0)).toBe(100);
    expect(b.retryAfter('b', rule, 0)).toBe(0); // 'b' untouched
  });

  it('reset() clears all state', () => {
    const b = new FailureBackoff();
    for (let i = 0; i < 3; i++) b.recordFailure('k', rule, 0);
    b.reset();
    expect(b.retryAfter('k', rule, 0)).toBe(0);
  });
});
