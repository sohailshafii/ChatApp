import { createRateLimiter, type RateLimitRule } from './rate-limiter.js';

// Per-caller username-lookup rate limit (§6) — a burst guard on the human-peer
// resolution in POST /conversations, the one place a caller turns an arbitrary
// username into "exists & verified?". The endpoint returns a generic not_found so
// a single probe doesn't confirm a username, but an unbounded caller can still
// enumerate the user base by sweeping candidates (and hammer the accounts lookup);
// this caps that. Bot-peer resolution hits the in-process registry (a fixed, tiny
// set) so it isn't gated here. Rounds out the four §6 rate-limit surfaces (auth,
// message-send, bot-invocation, username-lookup) on the shared fixed-window
// primitive (Redis or in-memory by REDIS_URL). Exported so tests can
// saturate/reset it, like the others.
export const usernameLookupLimiter = createRateLimiter();

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes, matching the auth-endpoint window.

// GLOBAL (whole-fleet) caps. Keyed both per-caller account (the dominant signal —
// the authenticated session owner) and per-IP (a backstop when one host drives
// many accounts). Generous for real use — you don't start dozens of fresh
// conversations in 10 minutes — but bounds enumeration sharply; tune against real
// traffic.
export const USERNAME_LOOKUP_LIMITS = {
  perAccount: { max: 60, windowMs: WINDOW_MS } satisfies RateLimitRule,
  perIp: { max: 120, windowMs: WINDOW_MS } satisfies RateLimitRule,
} as const;

export function usernameLookupAccountKey(accountId: string): string {
  return `username-lookup:account:${accountId}`;
}

export function usernameLookupIpKey(ip: string): string {
  return `username-lookup:ip:${ip}`;
}
