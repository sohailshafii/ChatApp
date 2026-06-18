import { createRateLimiter, type RateLimitRule } from './rate-limiter.js';

// Per-user message-send rate limit (§3/§6) — a burst guard on the WebSocket send
// path so a client can't flood messages (the only send path with no cap until
// now; bot invocation + auth already have one). Reuses the shared fixed-window
// primitive (Redis or in-memory by REDIS_URL). Exported so tests can
// saturate/reset it, like the others.
export const messageLimiter = createRateLimiter();

// GLOBAL (whole-fleet) allowance. A short window so a normal fast back-and-forth
// refills quickly; tune against real traffic. ~3 messages/sec sustained per user
// is generous for humans, ruinous for a flood script.
export const MESSAGE_LIMITS = {
  send: { max: 30, windowMs: 10_000 } satisfies RateLimitRule,
} as const;

export function messageSendKey(accountId: string): string {
  return `msg:send:${accountId}`;
}
