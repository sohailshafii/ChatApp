import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rate-limiter.js';
import { BOT_LIMITS, botInvocationKey } from './bot-rate-limit.js';

describe('bot invocation rate limit', () => {
  it('keys per (user, bot)', () => {
    expect(botInvocationKey('u1', 'assistant')).toBe('bot:invoke:u1:assistant');
    expect(botInvocationKey('u1', 'assistant')).not.toBe(
      botInvocationKey('u1', 'other'),
    );
    expect(botInvocationKey('u1', 'assistant')).not.toBe(
      botInvocationKey('u2', 'assistant'),
    );
  });

  it('allows BOT_LIMITS.invoke.max hits in the window, then blocks', async () => {
    const rl = new InMemoryRateLimiter();
    const key = botInvocationKey('u1', 'assistant');
    for (let i = 0; i < BOT_LIMITS.invoke.max; i++) {
      expect(await rl.check(key, BOT_LIMITS.invoke, 0)).toBe(true);
    }
    expect(await rl.check(key, BOT_LIMITS.invoke, 0)).toBe(false);
  });

  it('limits each (user, bot) independently', async () => {
    const rl = new InMemoryRateLimiter();
    const a = botInvocationKey('u1', 'assistant');
    const b = botInvocationKey('u2', 'assistant');
    for (let i = 0; i < BOT_LIMITS.invoke.max; i++) await rl.check(a, BOT_LIMITS.invoke, 0);
    expect(await rl.check(a, BOT_LIMITS.invoke, 0)).toBe(false);
    expect(await rl.check(b, BOT_LIMITS.invoke, 0)).toBe(true); // separate window
  });
});
