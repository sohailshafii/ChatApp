import { createRateLimiter, type RateLimitRule } from './rate-limiter.js';

// Per-user/per-bot invocation rate limit (§3/§6) — a burst guard on bot replies,
// separate from the token budget (§cost, see src/bots/budget.ts). Reuses
// the shared fixed-window primitive (Redis or in-memory by REDIS_URL). Exported so
// tests can saturate/reset it, like `authLimiter`.
export const botLimiter = createRateLimiter();

// GLOBAL (whole-fleet) allowance — bounds rapid-fire invocations without tripping
// a normal back-and-forth; tune against real traffic.
export const BOT_LIMITS = {
  invoke: { max: 20, windowMs: 60_000 } satisfies RateLimitRule,
} as const;

export function botInvocationKey(accountId: string, botId: string): string {
  return `bot:invoke:${accountId}:${botId}`;
}
