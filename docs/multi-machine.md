# Multi-machine scaling plan (deferred hardening)

> **Status:** planned, not started. v1 ships pinned to a **single machine**
> (`fly.toml`, `N = 1`). This document scopes the work needed to run `N > 1`
> safely. It is a design/scoping doc, not a spec change — see
> [`REQUIREMENTS.md`](../REQUIREMENTS.md) §6 for the underlying requirements
> (global rate limits, per-user fan-out).

## Why we're pinned to one machine

Two pieces of server state live **in-process**, so a second machine would each
keep its own copy and they'd silently disagree:

1. **Rate-limit counters** — every limiter (`src/rate-limit/`) counts in a
   per-process `Map`. N machines counting independently means the true cap is up
   to N× the intended global cap.
2. **The WebSocket hub** — `src/ws/hub.ts` maps `accountId → live sockets` for
   the current process only. A message sent on machine A never reaches a
   recipient whose socket is on machine B.

There's a third, milder issue: **background jobs** (retention sweeper, export
worker) are started on every machine, so they'd run N times over.

**Update (phase 2 done):** (1) is now solved when `REDIS_URL` is set — the
rate-limit counters and login backoff use a shared Redis store, so the caps are
exact global caps across machines (the old `perMachineMax` /
`RATE_LIMIT_MACHINE_COUNT` per-machine-division stopgap has been removed). The
**hub (2)** is now the hard blocker — it has no stopgap, which is why `N = 1` is
still enforced. (3) is unchanged.

## Decision: back both halves with Redis

The work splits into two largely independent halves that share one new piece of
infrastructure:

- **Half A** — shared, atomic rate-limit counters.
- **Half B** — a pub/sub bus + presence layer for cross-machine WS fan-out.

**Both are backed by Redis** (decided 2026-06-07). Redis fits each half natively:
`INCR`/`EXPIRE` for fixed-window counters, a small Lua script for the
read-modify-write of the login backoff, and `PUBLISH`/`SUBSCRIBE` + key-TTL
presence for fan-out. The alternative (Postgres-only: a counter table +
`LISTEN/NOTIFY` + a presence table) avoids a new service but is a worse fit for
fan-out (8 KB `NOTIFY` payload cap, a dedicated listener connection per machine,
every machine receiving every notify) and more code.

**Provisioning:** Fly offers Upstash Redis (managed, pay-per-command) or a Fly
Redis/Valkey app. Pick at implementation time; the command-cost profile of
Upstash at our message volume is an open question (see below).

**Local dev & tests stay Redis-free.** `REDIS_URL` is **optional**: when unset,
the limiters and hub fall back to the current in-process implementations — the
same "optional infra" pattern already used for the mail sender (`RESEND_API_KEY`),
bot providers (API keys), and Web Push (VAPID keys). So `N = 1` keeps working
with no Redis, and the test suite doesn't need a Redis container by default.

## Half A — shared rate-limit counters

**Surfaces** (all in `src/rate-limit/`): four `RateLimiter` instances —
`authLimiter`, `botLimiter`, `messageLimiter`, `usernameLookupLimiter` — plus the
`FailureBackoff` login limiter (`loginBackoff`, added in the exponential-backoff
work).

**Approach:** keep each primitive's *interface* and swap its *backend*, so call
sites barely change.

- `RateLimiter.check(key, rule)` → `INCR ratelimit:{key}`, and `EXPIRE
  ratelimit:{key} windowMs` **only when the counter is newly created** (i.e. the
  `INCR` returned 1). One round trip via a pipeline or a tiny Lua script for
  atomicity; over the cap when the post-incr value exceeds `rule.max`.
- `FailureBackoff` → a hash per key `{ failures, lockedUntil }`; `recordFailure`
  is a read-modify-write best done in Lua (compute the next lockout server-side).
  `retryAfter` is a plain read; `recordSuccess` is `DEL`.
- **Delete `perMachineMax` and `RATE_LIMIT_MACHINE_COUNT`** — the counters become
  truly global, so the division (and its overshoot) is gone. `AUTH_LIMITS` /
  `BOT_LIMITS` / etc. become exact global caps.

**The one real ripple: `check()` becomes async.** Redis calls are async, so the
limiter methods return promises. Call sites that are currently synchronous
(`rateLimited()` in the auth routes, the WS `handleSend` guard, the bot
orchestrator's pre-flight) must `await`. This is the bulk of the code churn for
Half A and should be done carefully (the WS path especially).

**Fallback:** behind a small interface, `REDIS_URL` unset selects the existing
in-memory `RateLimiter`/`FailureBackoff`; set selects the Redis-backed versions.

## Half B — WS fan-out via pub/sub + presence

The local `hub` stays as the **per-process socket registry** (a machine still
needs to know *its own* sockets to write bytes to them). Two layers go on top:

**Presence** — "which accounts have a live socket on *any* machine":
- On socket connect: `SET presence:{accountId}:{machineId} 1 EX <ttl>`, refreshed
  by a heartbeat while the socket is open; on disconnect, `DEL` that key (TTL
  covers crashes).
- An account is **online** iff any `presence:{accountId}:*` key exists.

**Bus** — deliver a frame to whatever machine holds the target sockets:
- To fan out to an account: `PUBLISH ws:account:{accountId} <frame-json>`.
- Each machine `SUBSCRIBE`s for the accounts it currently has sockets for (or a
  pattern subscription), and on receipt writes the frame to its local `hub`
  sockets for that account.

**Call sites that change** (all currently read `hub.socketsForAccount(...)`):
- `broadcastToAccounts` (`src/ws/send.ts`) — bot stream frames → publish to the
  bus instead of looping local sockets.
- the inline fan-out loop in `handleSend` (`src/ws/server.ts`) — human messages →
  publish; **skip the origin socket** still needs handling (tag frames with an
  origin socket/connection id so the publishing machine doesn't echo to the
  sender's originating tab, while still reaching the sender's *other* tabs).
- `dispatchMessagePush` (`src/push/dispatcher.ts`) — "offline" flips from
  `hub.socketsForAccount(id).size === 0` to "no `presence:{id}:*` key", which
  fixes the current cross-machine **spurious push** bug.

**Design wrinkle — the `delivered` receipt (§3).** Today the sender gets a
`delivered` frame when a *peer* socket received the message, known synchronously
because it's the same process. Cross-machine, the delivering machine would have
to ack back over the bus (a second publish to `ws:account:{senderId}`), or we
downgrade `delivered` to a presence-based heuristic (peer is online ⇒ delivered).
Pick one; the ack-back is more honest, the heuristic is simpler.

**Delivery semantics.** Live frames can be best-effort: Redis pub/sub is
at-most-once with no persistence, but messages are already **persisted before
fan-out** and clients **backfill history on reconnect**, so a dropped live frame
self-heals. That makes plain pub/sub acceptable — no need for Redis Streams /
consumer groups in v1.

## Secondary — background jobs run once, not N times

`startRetentionSweeper` and `startExportWorker` (wired in `src/index.ts`) fire on
every machine. The export worker already claims rows `FOR UPDATE SKIP LOCKED`, so
it's *safe* under concurrency, just wasteful; the retention deletes are
idempotent. Options, cheapest first:

1. **Leader lock** — wrap each tick in a Postgres advisory lock
   (`pg_try_advisory_lock`) or a Redis `SET NX EX`; only the holder runs. Small,
   no infra change.
2. **A single scheduled machine / cron** — move the jobs off the request machines
   entirely (a Fly scheduled machine or `fly machine run`). Cleaner long-term,
   more ops setup.

Recommend (1) now, (2) if/when we add more periodic work.

**✅ Done (phase 5):** option (1) via Redis. `src/redis/leader.ts` `shouldRunJob(name, ttlMs)` — an atomic acquire-or-renew Lua lock per job (`joblock:{name}`); the retention sweeper and export worker gate each tick on it (TTL = 2× interval, so the holder keeps leadership and a dead holder's lock expires for another to take over). Without Redis it always returns true (N=1 runs as before); fail-open on Redis error (idempotent, so harmless).

## Phasing (independent, shippable PRs)

1. **Redis plumbing** — add the client + `REDIS_URL` config (optional, with the
   in-memory fallback wired through a factory), a health check, graceful
   connect/close in `index.ts`. No behavior change; `N = 1` path untouched.
   **✅ Done** — `src/redis/client.ts` (`ioredis`, lazy-connect, optional via
   `REDIS_URL`; `getRedis()` returns `null` when unset → in-process fallback;
   `connectRedis`/`closeRedis` wired into `index.ts`, with a boot-time `PING`).
   Nothing reads Redis yet.
2. **Half A** — Redis-backed counters + backoff behind the factory; make the
   limiter API async and `await` at call sites; delete `perMachineMax` /
   `RATE_LIMIT_MACHINE_COUNT`.
   **✅ Done** — `RateLimiter`/`FailureBackoff` are async interfaces with
   `InMemory*` and `Redis*` backends, picked by `REDIS_URL` via
   `createRateLimiter`/`createFailureBackoff`. Redis counters = atomic
   `INCR`+`PEXPIRE` Lua (`rl:*`); backoff = a Redis hash with a Lua RMW (`bo:*`);
   both fail open on Redis errors. `perMachineMax`/`RATE_LIMIT_MACHINE_COUNT`
   removed (caps are now exact global). Real-Redis tests in
   `rate-limit/redis-backend.test.ts` (skipped unless `TEST_REDIS_URL`).
3. **Half B presence** — presence registry + repoint `dispatchMessagePush`
   offline-detection to it (fixes spurious cross-machine push on its own).
   **✅ Done** — `ws/presence.ts`: a `Presence` interface with `LocalPresence`
   (in-memory, the local hub = the fleet at N=1) and `RedisPresence` (a ZSET per
   account, member = machineId, score = expiry; `online()` prunes stale members
   then checks `ZCARD`, short-circuiting on the local hub first). Refreshed on WS
   connect + a `startPresenceHeartbeat` (every 25s, TTL 60s), cleared when a
   machine's last socket for an account closes. `dispatchMessagePush` now uses
   `presence.online()`. Real-Redis tests in `ws/presence.test.ts` (skipped unless
   `TEST_REDIS_URL`). NB: this fixes *push* offline-detection across machines; the
   live *message* fan-out still needs the bus (phase 4).
4. **Half B bus** — pub/sub fan-out for human messages, bot streaming, and the
   `delivered` receipt; origin-echo handling.
   **✅ Done** — `ws/bus.ts`: a `MessageBus` (`LocalBus` / `RedisBus` by
   `REDIS_URL`). `publish()` writes to local sockets immediately and, on Redis,
   PUBLISHes an envelope tagged with the origin machine id to one `ws:bus` channel;
   each machine's subscriber (`startMessageBus` in `index.ts`) delivers foreign
   frames to its local sockets via `deliverFromBus`, skipping its own echo. The
   origin socket is always local, so the "skip the sender's originating tab" is a
   local-only concern (no connection-id on the wire). `broadcastToAccounts` (bot
   streaming) routes through the bus unchanged. **`delivered`** resolved to the
   **presence heuristic** (peer online ⇒ delivered) — equals the old behavior at
   N=1, no bus-ack round trip. Tests in `ws/bus.test.ts` (local + real-Redis publish,
   skipped unless `TEST_REDIS_URL`); verified end-to-end with a two-instance smoke
   (message sent on instance A delivered to a socket on instance B over Redis).
   (The account-deletion socket close that was local-only here is now fleet-wide —
   see phase 5.)
5. **Background-job leader lock** + **fleet-wide account-deletion socket close.**
   **✅ Done** — leader lock as above (`shouldRunJob`). Also added a bus **control**
   channel (`ws:control`): `bus.closeAccount(id)` closes local sockets and publishes
   a `close` control message so every machine drops that account's sockets; the
   account-deletion route uses it. So a deleted user can no longer keep acting from a
   tab on another machine. (`applyControlFromBus`, tests in `ws/bus.test.ts`;
   verified with a two-instance smoke.)
6. **Flip the switch** (turn it on) — provision Redis/Valkey + set `REDIS_URL`, then
   remove the `N = 1` guardrail in `fly.toml`, set the target scale, update ops docs.
   All the functional pieces (phases 2–5) are in place; this phase is purely
   provisioning + configuration.

Phases 2–5 each depend only on phase 1 and can otherwise land in any order; phase
6 depends on all of them. **Phases 1–5 are done** — only phase 6 (provisioning +
flipping the switch) remains.

## Open questions

- **Presence tuning** — heartbeat interval vs. TTL (responsiveness vs. Redis
  write rate). Currently 25s heartbeat / 60s TTL.
- ~~**`delivered` fidelity**~~ — resolved: presence heuristic (phase 4).
- **Bus efficiency** — phase 4 uses one `ws:bus` channel, so every machine
  receives every published frame. Fine at small N; if it matters, move to
  per-account channels (subscribe/unsubscribe as sockets come/go) or conditional
  publish via presence. Not needed for v1 scale-out.
- **Upstash cost** — per-command pricing at expected message volume; favors a
  dedicated Fly Redis/Valkey over per-command Upstash (the current lean).
- **Managed choice** — Upstash Redis vs. Fly Redis/Valkey (an ops call at
  provisioning).

## Test strategy

- Keep the **in-memory fallback as the default test backend** — existing tests
  run unchanged, no Redis in CI by default.
- Add **targeted Redis-backed tests** against a Redis container (mirroring how
  integration tests use a dedicated Postgres), covering the counter/backoff Lua
  and the presence TTL.
- A **two-machine fan-out test**: two app instances sharing one Redis; assert a
  message published on instance A is delivered to a socket connected to instance
  B, and that presence/offline-detection agrees across both.

## Touch list (quick reference)

| Area | Files |
| --- | --- |
| Rate-limit counters | `src/rate-limit/rate-limiter.ts`, `auth-rate-limit.ts`, `bot-rate-limit.ts`, `message-rate-limit.ts`, `username-lookup-rate-limit.ts`, `backoff.ts` |
| WS fan-out | `src/ws/hub.ts`, `src/ws/send.ts`, `src/ws/server.ts` |
| Push offline-detection | `src/push/dispatcher.ts` |
| Background jobs | `src/index.ts`, `src/auth/retention.ts`, `src/auth/export-worker.ts` |
| Config / infra | `src/config.ts`, `.env.example`, `fly.toml` |
