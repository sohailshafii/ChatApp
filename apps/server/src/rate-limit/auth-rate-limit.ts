import type { FastifyReply } from 'fastify';
import { sendError } from '../http/errors.js';
import { createRateLimiter, type RateLimitRule } from './rate-limiter.js';
import { createFailureBackoff, type BackoffRule } from './backoff.js';

// One limiter instance for all auth endpoints (§6). Exported so tests can reset
// it between cases. createRateLimiter picks the Redis or in-memory backend by
// REDIS_URL — call sites just await check().
export const authLimiter = createRateLimiter();

// Failure-driven exponential backoff for repeated *failed logins* (§6) — the
// "exponential backoff on repeated failure" the spec asks for, keyed per account.
// It supersedes a crude per-account volumetric cap, which counted successes too
// and didn't escalate; here an honest user resets the streak by logging in, while
// an attacker grinding one credential is locked out for geometrically longer. The
// per-IP volumetric cap (loginPerIp, below) still bounds an IP sweeping many
// usernames. Exported so tests can reset it between cases.
export const loginBackoff = createFailureBackoff();

// 3 free attempts (typos), then lock 1s, 2s, 4s … doubling up to 15 min.
export const LOGIN_BACKOFF: BackoffRule = {
  freeRetries: 3,
  baseMs: 1_000,
  maxMs: 15 * 60 * 1000,
};

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
// GLOBAL (whole-fleet) cap per window — exact with the Redis backend, and exact at
// N=1 with the in-memory backend (the only way we run without Redis).
const perWindow = (max: number): RateLimitRule => ({ max, windowMs: WINDOW_MS });

// Per-IP and per-account GLOBAL allowances for the auth endpoints §6 calls out
// (signup, login, password reset, verification resend). Tuned to bound abuse
// without tripping normal use; revisit against real traffic.
export const AUTH_LIMITS = {
  signupPerIp: perWindow(10),
  // Login has no per-account volumetric cap — repeated failures are handled by
  // loginBackoff (above); this per-IP cap bounds an IP sweeping many usernames.
  loginPerIp: perWindow(20),
  resendPerIp: perWindow(5),
  resendPerAccount: perWindow(5),
  resetPerIp: perWindow(5),
  resetPerAccount: perWindow(5),
  // Data export (§6) is expensive to generate; cap it tightly per requester.
  exportPerAccount: perWindow(3),
  exportPerIp: perWindow(5),
} as const;

// Account-keyed limits normalize the identifier (lowercase) to match the citext,
// case-insensitive semantics of usernames/emails.
export function accountKey(action: string, identifier: string): string {
  return `${action}:account:${identifier.toLowerCase()}`;
}

export function ipKey(action: string, ip: string): string {
  return `${action}:ip:${ip}`;
}

// Sends the standard 429 rate_limited response for a backoff lockout, adding a
// Retry-After header (seconds, rounded up) so a well-behaved client knows how long
// to wait before retrying.
export function sendBackoff(reply: FastifyReply, retryAfterMs: number): FastifyReply {
  reply.header('Retry-After', Math.ceil(retryAfterMs / 1000));
  return sendError(
    reply,
    'rate_limited',
    'Too many failed attempts. Please wait a bit and try again.',
  );
}

// Applies each (key, rule) check in order. On the first breach it sends a 429
// rate_limited response and resolves true, signalling the caller to stop. Resolves
// false when every check is within limits.
export async function rateLimited(
  reply: FastifyReply,
  checks: ReadonlyArray<{ key: string; rule: RateLimitRule }>,
): Promise<boolean> {
  for (const { key, rule } of checks) {
    if (!(await authLimiter.check(key, rule))) {
      sendError(
        reply,
        'rate_limited',
        'Too many attempts. Please wait a bit and try again.',
      );
      return true;
    }
  }
  return false;
}
