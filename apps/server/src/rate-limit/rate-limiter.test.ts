import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

const rule = { max: 3, windowMs: 1000 };

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
