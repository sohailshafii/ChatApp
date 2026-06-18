import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rate-limiter.js';
import { MESSAGE_LIMITS, messageSendKey } from './message-rate-limit.js';

describe('message-send rate limit', () => {
  it('keys per user', () => {
    expect(messageSendKey('u1')).toBe('msg:send:u1');
    expect(messageSendKey('u1')).not.toBe(messageSendKey('u2'));
  });

  it('allows MESSAGE_LIMITS.send.max sends in the window, then blocks', async () => {
    const rl = new InMemoryRateLimiter();
    const key = messageSendKey('u1');
    for (let i = 0; i < MESSAGE_LIMITS.send.max; i++) {
      expect(await rl.check(key, MESSAGE_LIMITS.send, 0)).toBe(true);
    }
    expect(await rl.check(key, MESSAGE_LIMITS.send, 0)).toBe(false);
  });

  it('limits each user independently', async () => {
    const rl = new InMemoryRateLimiter();
    for (let i = 0; i < MESSAGE_LIMITS.send.max; i++) {
      await rl.check(messageSendKey('u1'), MESSAGE_LIMITS.send, 0);
    }
    expect(await rl.check(messageSendKey('u1'), MESSAGE_LIMITS.send, 0)).toBe(false);
    expect(await rl.check(messageSendKey('u2'), MESSAGE_LIMITS.send, 0)).toBe(true);
  });
});
