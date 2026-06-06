import { describe, it, expect } from 'vitest';
import { RateLimiter, perMachineMax } from './rate-limiter.js';

const rule = { max: 3, windowMs: 1000 };

describe('perMachineMax', () => {
  it('returns the global cap unchanged on a single machine', () => {
    expect(perMachineMax(20, 1)).toBe(20);
    expect(perMachineMax(5, 1)).toBe(5);
  });

  it('divides the global cap across machines, rounding up', () => {
    expect(perMachineMax(20, 4)).toBe(5); // exact
    expect(perMachineMax(5, 2)).toBe(3); // ceil(2.5) — fleet sums to ~6
    expect(perMachineMax(21, 4)).toBe(6); // ceil(5.25)
  });

  it('never drops below 1 per machine (tiny cap, many machines)', () => {
    expect(perMachineMax(3, 10)).toBe(1);
  });
});

describe('RateLimiter', () => {
  it('allows up to max hits then blocks within the window', () => {
    const rl = new RateLimiter();
    expect(rl.check('k', rule, 0)).toBe(true); // 1
    expect(rl.check('k', rule, 0)).toBe(true); // 2
    expect(rl.check('k', rule, 0)).toBe(true); // 3
    expect(rl.check('k', rule, 0)).toBe(false); // 4 -> over limit
  });

  it('tracks keys independently', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 3; i++) expect(rl.check('a', rule, 0)).toBe(true);
    expect(rl.check('a', rule, 0)).toBe(false);
    expect(rl.check('b', rule, 0)).toBe(true); // 'b' has its own window
  });

  it('refreshes the allowance once the window elapses', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 3; i++) rl.check('k', rule, 0);
    expect(rl.check('k', rule, 0)).toBe(false);
    expect(rl.check('k', rule, 1000)).toBe(true); // new window at resetAt
  });

  it('reset() clears all windows', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 3; i++) rl.check('k', rule, 0);
    expect(rl.check('k', rule, 0)).toBe(false);
    rl.reset();
    expect(rl.check('k', rule, 0)).toBe(true);
  });
});
