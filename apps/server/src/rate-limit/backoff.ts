// Failure-driven exponential backoff (§6) — the companion to the fixed-window
// `RateLimiter`. Where the limiter caps request *volume* over a window, this caps
// *repeated failures* against a single key (e.g. one account's login) by locking
// it out for a duration that doubles with each consecutive failure, and clears the
// moment the caller succeeds. That's the "exponential backoff on repeated failure"
// §6 asks of the auth endpoints: an attacker grinding one credential is slowed
// geometrically, while an honest user who fat-fingers a few times then logs in is
// untouched (success resets the counter).
//
// In-memory, per process — same caveat as the limiter: a shared store (Redis/PG)
// is the multi-machine fix. Per-key state is dropped on success, so the map only
// holds keys with an active failure streak.

export type BackoffRule = {
  // Consecutive failures allowed with NO lockout before backoff engages — room for
  // honest typos. The (freeRetries + 1)-th failure is the first to lock.
  freeRetries: number;
  // Lockout for the first penalized failure; doubles each subsequent failure.
  baseMs: number;
  // Ceiling on the lockout duration (the doubling saturates here).
  maxMs: number;
};

type State = { failures: number; lockedUntil: number };

export class FailureBackoff {
  private readonly states = new Map<string, State>();

  // Milliseconds the caller must wait before this key is allowed again — 0 when
  // it's free to proceed. Read-only: it neither counts nor extends anything (call
  // it before attempting the protected action). `now` is injectable for tests.
  retryAfter(key: string, rule: BackoffRule, now: number = Date.now()): number {
    const state = this.states.get(key);
    if (!state) return 0;
    return Math.max(0, state.lockedUntil - now);
  }

  // Records a failure for `key` and returns the resulting lockout in ms (0 while
  // still within the free-retry grace). The lockout grows as
  // baseMs * 2^(failures - freeRetries - 1), capped at maxMs.
  recordFailure(key: string, rule: BackoffRule, now: number = Date.now()): number {
    const failures = (this.states.get(key)?.failures ?? 0) + 1;
    const penalized = failures - rule.freeRetries;
    const lockMs =
      penalized <= 0
        ? 0
        : Math.min(rule.baseMs * 2 ** (penalized - 1), rule.maxMs);
    this.states.set(key, { failures, lockedUntil: now + lockMs });
    return lockMs;
  }

  // Clears the failure streak for `key` — call on a successful attempt.
  recordSuccess(key: string): void {
    this.states.delete(key);
  }

  // Drops all tracked state (test/maintenance helper).
  reset(): void {
    this.states.clear();
  }
}
