// Fixed-window in-memory rate limiter — the single primitive shared across auth
// endpoints now, and username lookup / message send / bot invocation later (§6).
//
// In-memory means the counters are PER PROCESS: running multiple machines
// multiplies the effective limit and lets an attacker spread load across them.
// That is acceptable for v1 (small machine count; auth is low-volume), but the
// store should move to Redis/Postgres before we scale out. Call sites only touch
// `check()`, so swapping the backend won't ripple outward.

export type RateLimitRule = {
  // Maximum allowed hits per key within the window.
  max: number;
  // Window length in milliseconds.
  windowMs: number;
};

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
