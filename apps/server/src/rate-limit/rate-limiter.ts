// Fixed-window in-memory rate limiter — the single primitive shared across auth
// endpoints + bot invocation (§6), and username lookup / message send later.
//
// In-memory means the counters are PER PROCESS: each machine counts only its own
// traffic. We express limits as GLOBAL (whole-fleet) caps and approximate them
// without a shared store by dividing each cap across the machines we run — see
// `perMachineMax`. The exact fix is a shared store (Redis/Postgres atomic
// counters); call sites only touch `check()`, so swapping the backend won't
// ripple outward.

import { loadConfig } from '../config.js';

export type RateLimitRule = {
  // Maximum allowed hits per key within the window.
  max: number;
  // Window length in milliseconds.
  windowMs: number;
};

// Converts a GLOBAL (whole-fleet) cap into the per-machine cap this in-memory
// limiter enforces, by dividing across RATE_LIMIT_MACHINE_COUNT. With N machines
// each allowing ceil(G/N), the fleet sums to ~G (slightly over: ceil rounding
// adds up to N-1, and a cap below N floors at 1/machine). Single machine (N=1)
// is exact. `machines` is injectable for testing.
export function perMachineMax(
  globalMax: number,
  machines: number = loadConfig().rateLimitMachineCount,
): number {
  return Math.max(1, Math.ceil(globalMax / machines));
}

type Window = { count: number; resetAt: number };

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  // Records a hit for `key` and returns true if it is within the limit, or false
  // if the key has exhausted its allowance for the current window. `now` is
  // injectable so the behavior is deterministically testable.
  check(key: string, rule: RateLimitRule, now: number = Date.now()): boolean {
    const existing = this.windows.get(key);
    if (!existing || now >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return true;
    }
    if (existing.count >= rule.max) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  // Drops all tracked windows (test/maintenance helper).
  reset(): void {
    this.windows.clear();
  }
}
