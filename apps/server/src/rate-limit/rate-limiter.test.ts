import { describe, it, expect } from 'vitest';
import { InMemoryRateLimiter } from './rate-limiter.js';

const rule = { max: 3, windowMs: 1000 };

describe('InMemoryRateLimiter', () => {
  it('allows up to max hits then blocks within the window', async () => {
    const rl = new InMemoryRateLimiter();
    expect(await rl.check('k', rule, 0)).toBe(true); // 1
    expect(await rl.check('k', rule, 0)).toBe(true); // 2
    expect(await rl.check('k', rule, 0)).toBe(true); // 3
    expect(await rl.check('k', rule, 0)).toBe(false); // 4 -> over limit
  });

  it('tracks keys independently', async () => {
    const rl = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) expect(await rl.check('a', rule, 0)).toBe(true);
    expect(await rl.check('a', rule, 0)).toBe(false);
    expect(await rl.check('b', rule, 0)).toBe(true); // 'b' has its own window
  });

  it('refreshes the allowance once the window elapses', async () => {
    const rl = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) await rl.check('k', rule, 0);
    expect(await rl.check('k', rule, 0)).toBe(false);
    expect(await rl.check('k', rule, 1000)).toBe(true); // new window at resetAt
  });

  it('reset() clears all windows', async () => {
    const rl = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) await rl.check('k', rule, 0);
    expect(await rl.check('k', rule, 0)).toBe(false);
    rl.reset();
    expect(await rl.check('k', rule, 0)).toBe(true);
  });
});
