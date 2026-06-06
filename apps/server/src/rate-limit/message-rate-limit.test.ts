import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';
import { MESSAGE_LIMITS, messageSendKey } from './message-rate-limit.js';

describe('message-send rate limit', () => {
  it('keys per user', () => {
    expect(messageSendKey('u1')).toBe('msg:send:u1');
    expect(messageSendKey('u1')).not.toBe(messageSendKey('u2'));
  });

  it('allows MESSAGE_LIMITS.send.max sends in the window, then blocks', () => {
    const rl = new RateLimiter();
    const key = messageSendKey('u1');
    for (let i = 0; i < MESSAGE_LIMITS.send.max; i++) {
      expect(rl.check(key, MESSAGE_LIMITS.send, 0)).toBe(true);
    }
    expect(rl.check(key, MESSAGE_LIMITS.send, 0)).toBe(false);
  });

  it('limits each user independently', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < MESSAGE_LIMITS.send.max; i++) {
      rl.check(messageSendKey('u1'), MESSAGE_LIMITS.send, 0);
    }
    expect(rl.check(messageSendKey('u1'), MESSAGE_LIMITS.send, 0)).toBe(false);
    expect(rl.check(messageSendKey('u2'), MESSAGE_LIMITS.send, 0)).toBe(true);
  });
});
