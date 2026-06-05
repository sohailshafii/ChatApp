import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';
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

  it('allows BOT_LIMITS.invoke.max hits in the window, then blocks', () => {
    const rl = new RateLimiter();
    const key = botInvocationKey('u1', 'assistant');
    for (let i = 0; i < BOT_LIMITS.invoke.max; i++) {
      expect(rl.check(key, BOT_LIMITS.invoke, 0)).toBe(true);
    }
    expect(rl.check(key, BOT_LIMITS.invoke, 0)).toBe(false);
  });

  it('limits each (user, bot) independently', () => {
    const rl = new RateLimiter();
    const a = botInvocationKey('u1', 'assistant');
    const b = botInvocationKey('u2', 'assistant');
    for (let i = 0; i < BOT_LIMITS.invoke.max; i++) rl.check(a, BOT_LIMITS.invoke, 0);
    expect(rl.check(a, BOT_LIMITS.invoke, 0)).toBe(false);
    expect(rl.check(b, BOT_LIMITS.invoke, 0)).toBe(true); // separate window
  });
});
