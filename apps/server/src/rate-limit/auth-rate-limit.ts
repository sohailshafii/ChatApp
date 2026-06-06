import type { FastifyReply } from 'fastify';
import { sendError } from '../http/errors.js';
import { RateLimiter, type RateLimitRule } from './rate-limiter.js';

// One limiter instance for all auth endpoints (§6). Exported so tests can reset
// it between cases.
export const authLimiter = new RateLimiter();

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const perWindow = (max: number): RateLimitRule => ({ max, windowMs: WINDOW_MS });

// Per-IP and per-account allowances for the auth endpoints §6 calls out (signup,
// login, password reset, verification resend). Tuned to bound abuse without
// tripping normal use; revisit against real traffic.
export const AUTH_LIMITS = {
  signupPerIp: perWindow(10),
  loginPerIp: perWindow(20),
  loginPerAccount: perWindow(5),
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

// Applies each (key, rule) check in order. On the first breach it sends a 429
// rate_limited response and returns true, signalling the caller to stop. Returns
// false when every check is within limits.
export function rateLimited(
  reply: FastifyReply,
  checks: ReadonlyArray<{ key: string; rule: RateLimitRule }>,
): boolean {
  for (const { key, rule } of checks) {
    if (!authLimiter.check(key, rule)) {
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
