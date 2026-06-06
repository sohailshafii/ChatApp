import { RateLimiter, perMachineMax, type RateLimitRule } from './rate-limiter.js';

// Per-user/per-bot invocation rate limit (§3/§6) — a burst guard on bot replies,
// separate from the per-day token budget (§cost, see src/bots/budget.ts). Reuses
// the shared fixed-window primitive. Exported so tests can saturate/reset it,
// like `authLimiter`. Per-process in-memory (same shared-store caveat as auth).
export const botLimiter = new RateLimiter();

// GLOBAL allowance (whole-fleet) — bounds rapid-fire invocations without tripping
// a normal back-and-forth; tune against real traffic. perMachineMax divides it
// across RATE_LIMIT_MACHINE_COUNT for this in-memory limiter.
export const BOT_LIMITS = {
  invoke: { max: perMachineMax(20), windowMs: 60_000 } satisfies RateLimitRule,
} as const;

export function botInvocationKey(accountId: string, botId: string): string {
  return `bot:invoke:${accountId}:${botId}`;
}
