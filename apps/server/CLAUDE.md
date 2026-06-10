# `apps/server` — Backend

Node + TypeScript backend for ChatApp. Full spec: [`../../REQUIREMENTS.md`](../../REQUIREMENTS.md).

## Scope

- REST endpoints (auth, account, conversation list, history).
- WebSocket server: connection handling, per-user fan-out, reconnect catch-up.
- Bot orchestration: calls to OpenAI / Anthropic.
- Push dispatcher: sends Web Push to inactive recipients.
- DB access (Postgres) and migrations.

## Out of scope

**Do not modify `apps/web` or `packages/shared` from this workspace** without explicit coordination. Shared-type changes are PRs of their own.

## Tech (intended, picked at first need)

- **Node 20+ LTS**.
- **TypeScript** strict mode.
- **Fastify** for HTTP.
- **`ws`** for WebSocket (lower-level than Socket.IO; we want explicit control of fan-out).
- **Postgres** via a thin query layer or Drizzle.
- Wire types imported from `@chatapp/shared`.

## Conventions

- Message ordering is by **server-assigned timestamp** — client clocks are never trusted.
- Persist the user message **before** calling the bot — the model call is a separate failure mode.
- Rate limits exist for auth, username lookup, message send, and bot invocation. Use a single primitive across them.
- Secrets (VAPID, bot API keys, DB) come from env / Fly secrets — never from source.

## Local development

Postgres runs in Docker via [`compose.yml`](../../compose.yml) at the repo root.
The npm scripts assume the Docker **daemon** is already running (Docker Desktop /
Colima / OrbStack). Full loop from a clean checkout, run from the **repo root**:

```bash
# 0. One-time: create your local env file (gitignored; defaults match compose.yml).
cp .env.example .env

# 1. Start the Docker daemon (e.g. `open -a Docker`), then bring up Postgres:
npm run db:up                          # docker compose up -d postgres

# 2. Apply migrations:
npm run migrate -w @chatapp/server     # applies pending SQL, tracked in schema_migrations

# 3. Run the server in watch mode (reloads on change):
npm run dev:server                     # listens on PORT (default 8080)
```

The `dev` and `migrate` scripts auto-load the repo-root `.env` via
`--env-file-if-exists`, so you don't need to export anything by hand. `config.ts`
reads `DATABASE_URL`, `PORT`, `LOG_LEVEL`, `APP_BASE_URL`, and optional
`RESEND_API_KEY` / `MAIL_FROM`; a missing required var fails fast at startup. (Production on Fly
gets these from secrets, not a `.env` file — hence `start` does not load one.)

### Exercising the API

With the server running, from any shell:

```bash
# Liveness probe (no DB touch):
curl -s http://localhost:8080/healthz                       # {"status":"ok"}

# Signup happy path — HTTP 200 with an EMPTY body:
curl -i -X POST http://localhost:8080/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"correct horse battery staple"}'

# Error paths return {"error":{"code":...,"message":...}}:
#   reused username            -> username_taken
#   reused email (case-insensitive, via citext) -> email_taken
#   short/invalid username, missing fields       -> validation_error
```

When `RESEND_API_KEY` is unset, signup **logs** the verification link instead of
emailing it — grep the server output for `verification link logged for dev` to
copy the `?token=…` URL. When it **is** set, all three mailers (verification,
password-reset, data-export) send for real via Resend (`src/mail/transport.ts`,
a `fetch` POST to the Resend API — no SDK dep; `setMailSender` is the test seam),
from **`MAIL_FROM`** (default `onboarding@resend.dev`; Resend only accepts a
sender on a domain verified in your account). Sends are **best-effort** — a
failure is logged, never thrown, so email never breaks the auth/account flow.
Inspect the persisted rows directly:

```bash
docker exec -it chatapp-postgres psql -U chatapp -d chatapp \
  -c 'SELECT username, email, verified FROM accounts;'
```

Verify the account using that token, or request a fresh link:

```bash
TOKEN=…   # the token from the logged /verify-email?token=… URL
# 200 on success; validation_error (400, malformed) / invalid_token (400) / expired_token (410):
curl -i -X POST http://localhost:8080/auth/verify-email \
  -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\"}"

# Resend — always 200, never reveals whether the email is registered/verified:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/auth/verify-email/resend \
  -H 'Content-Type: application/json' -d '{"email":"alice@example.com"}'
```

#### Login, session & logout

Login needs a **verified** account. Without a mail provider, mark one verified
by hand (or click the logged verification link):

```bash
docker exec -it chatapp-postgres psql -U chatapp -d chatapp \
  -c "UPDATE accounts SET verified = true WHERE username = 'alice';"
```

Use a cookie jar so the session + CSRF cookies persist across calls:

```bash
JAR=/tmp/chatapp-cookies.txt

# Login — 200 {"user":{…}}. Sets two cookies: `session` (httpOnly) and
# `csrf_token` (readable). Errors: invalid_credentials (401), unverified (403).
curl -s -c "$JAR" -X POST http://localhost:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"correct horse battery staple"}'

# Current user — 200 {"user":{…}} while the session is live, else 401:
curl -s -b "$JAR" http://localhost:8080/auth/me

# Logout — state-changing, so it needs the double-submit CSRF token: read the
# `csrf_token` cookie value and echo it in the X-CSRF-Token header. 204 on success;
# 403 csrf_failure if the header is missing/mismatched.
CSRF=$(awk '$6=="csrf_token"{print $7}' "$JAR")
curl -s -b "$JAR" -c "$JAR" -X POST http://localhost:8080/auth/logout \
  -H "X-CSRF-Token: $CSRF"
```

Cookie/header names are exported from `@chatapp/shared`
(`SESSION_COOKIE_NAME`, `CSRF_COOKIE_NAME`, `CSRF_HEADER_NAME`) so client and
server can't drift. Sessions use a 30-day sliding expiry (each authenticated
request bumps `last_active_at`); inspect them with
`SELECT account_id, last_active_at FROM sessions;`. `touchSession` *rejects* rows
past the window; the **retention sweeper** (`src/auth/retention.ts`,
`startRetentionSweeper`, started from `index.ts` after listen, every 6h + once at
boot) *deletes* them. It runs a list of `RETENTION_TASKS` — the "delete" half of
every expiry policy (§6/§7): **sessions** (`sweepExpiredSessions`, past the 30-day
window), **data_exports** (`sweepExpiredDataExports`, past the 24h download link —
dead bytea + PII), and **auth_audit_log** (`sweepOldAuditEvents`, older than
`AUDIT_RETENTION_DAYS`, default 180). A failing task is logged and doesn't stop
the others. In-process unref'd interval (per-machine; a single scheduled job is
the cleaner multi-machine home, alongside the rate-limit shared-store / hub→pub-sub
moves), wired only in the entrypoint so tests using `buildApp()` don't spin a
timer.

#### Password reset

The reset email links to `/password-reset/confirm?token=…` — the
`PASSWORD_RESET_CONFIRM_PATH` constant in `@chatapp/shared`. As with
verification, the link is logged (not emailed) while `RESEND_API_KEY` is unset.

```bash
# Request by username OR email — always 200, never reveals whether it matched:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/auth/password-reset/request \
  -H 'Content-Type: application/json' -d '{"identifier":"alice"}'
# Then grep the server log for `password-reset link logged for dev` to get the token.

# Confirm with that token + a new password. 200 on success (and ALL of the
# account's sessions are invalidated); invalid_token (400) / expired_token (410, 1h TTL):
TOKEN=…
curl -i -X POST http://localhost:8080/auth/password-reset/confirm \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"newPassword\":\"a brand new passphrase\"}"
```

#### Audit logging (§6)

A per-account log of auth events lives in `auth_audit_log` (migration 008),
written via `recordAuthEvent(log, event, {accountId, ip})` in `src/auth/audit.ts`
— best-effort (a failed insert is logged, never thrown) and awaited so the row is
ordered before the response. Wired now: `login`, `login_failure` (wrong password
*and* unverified; `account_id` is null for an unknown username), `password_reset`.
The `AuthEvent` union also reserves `account_deletion` and
`push_subscription_added`/`_removed` for when those endpoints land — no migration
needed to start emitting them. `account_id` is **`ON DELETE SET NULL`** so the log
outlives the account (deletion is itself an audited event; §6 keeps audit logs
~180 days). The user-facing "recent activity" view and retention pruning are
deferred follow-ups. Inspect with
`SELECT account_id, event, ip, created_at FROM auth_audit_log ORDER BY created_at;`.

#### Account deletion (§6)

`DELETE /auth/account` `{password}` (session + double-submit CSRF; re-auths with
the password, wrong → `invalid_credentials`). Immediate **hard delete**
(`deleteAccount` in `src/auth/account.ts`, one transaction): bot conversations are
hard-deleted (messages cascade), then the account row is deleted — cascading
sessions, tokens, `conversation_participants`, `bot_usage`. The user's
human-conversation **messages are retained** (`messages.sender_id` is plain text,
no FK), so the peer keeps their history; `resolvePeer` (in
`conversations/summaries.ts`) then renders the now-missing peer as the synthetic
`{kind:'human', id:NIL_UUID, username:'Deleted user'}`. Records the
`account_deletion` audit event **before** the delete (its `account_id` SET-NULLs
as the row goes), closes the account's live sockets, clears cookies, returns `200`
empty. Push-subscription cleanup rides a future `accounts ON DELETE CASCADE` FK
(no `push_subscriptions` table yet — upcoming §5 work).

#### Data export (§6)

`POST /auth/export` (no body; session + double-submit CSRF; rate-limited via
`AUTH_LIMITS.exportPer*` → `rate_limited`; records the `data_export_requested`
audit event). It **durably enqueues a job** — `enqueueExport` inserts a `pending`
row in `data_exports` (migration 009, now a job table per migration 011) *before*
the **200**, so a crash can't lose the request — and responds 200 empty
identically whether or not one is already in flight (no state leak).

The **export worker** (`src/auth/export-worker.ts`, `startExportWorker`, every 60s
+ once at boot, started only from `index.ts`) calls `processPendingExports`: it
claims pending rows with **`FOR UPDATE SKIP LOCKED`** (multi-machine-safe; one
machine in v1), builds the archive — profile + conversation metadata + full
message content, JSON — generates a token, and flips the row to `ready`
(`token_hash`/`content`/`filename`/`expires_at` set), then emails the link
(`mail/data-export.ts`; logged in dev while `RESEND_API_KEY` unset) after commit.
A build failure increments `attempts` and retries up to `MAX_EXPORT_ATTEMPTS` (3),
then marks the row `failed`. A pending job survives a restart — the worker picks
it up on the next boot. The link points at the **token-only** `GET
/auth/export/download?token=…` (no session — bearer capability like verify/reset),
which serves a **`ready`** archive as a file attachment
(`invalid_token`/`expired_token` otherwise). The retention sweep
(`sweepExpiredDataExports`) prunes `ready` rows past their 24h window, plus
`failed` and day-old abandoned `pending` jobs.

#### Web Push (§5)

Closed-tab notifications. `push_subscriptions` (migration 010) stores each
browser's subscription, keyed by its globally-unique `endpoint` (so register is
idempotent via `ON CONFLICT`), `account_id ON DELETE CASCADE` (so account deletion
removes them automatically). Endpoints in `src/routes/push.ts` (all session-gated;
state-changing ones CSRF-gated): `GET /push/vapid-public-key` (the
`applicationServerKey`; `internal_error` when no VAPID keypair), `POST
/push/subscriptions` (`pushSubscriptionSchema`, idempotent, audits
`push_subscription_added`), `DELETE /push/subscriptions` (own only, 204, audits
`push_subscription_removed`). The **dispatcher** (`src/push/dispatcher.ts`,
`dispatchMessagePush`) fires fire-and-forget from `ws/server.ts` (human messages)
and the bot orchestrator after `bot_end`: for each recipient with **no live socket
in the `hub`**, it sends `pushPayloadSchema` `{title, body, conversationId}` (title
= sender username or bot name) to their subscriptions via `web-push`
(`src/push/sender.ts`; `setPushSender` is a test seam), **pruning** any that return
404/410. **VAPID keys are optional** (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/
`VAPID_SUBJECT`); with none, push is disabled (dispatcher no-ops, the key endpoint
errors) — like the email/bot-key stubs. Offline detection is **per-process** (the
in-process hub — a recipient on another machine looks offline → a spurious push;
resolved by the hub→pub/sub move).

#### Rate limiting

Auth endpoints are rate limited (§6) by a single in-memory primitive in
`src/rate-limit/`. `signup`, `login`, `verify-email/resend`, and
`password-reset/request` are capped **per-IP** (and **per-account** where the
body carries an identifier) over a 10-minute window; exceeding a cap returns
**429** with `{"error":{"code":"rate_limited",…}}`. Limits live in `AUTH_LIMITS`.

**Login uses exponential backoff on repeated failure** (§6) instead of a per-
account volumetric cap. A second primitive, `FailureBackoff`
(`src/rate-limit/backoff.ts`, instance `loginBackoff` + rule `LOGIN_BACKOFF`),
tracks *consecutive failed logins* per username: after `freeRetries` (3) typos it
locks the account out for `baseMs·2^n` — 1s, 2s, 4s … capped at 15 min — checked
**before** the DB read/password hash, and the 429 carries a **`Retry-After`**
header (`sendBackoff`). A **successful login clears the streak**, so an honest
user who mistyped isn't penalized; only grinding one credential escalates. Keyed
by the submitted username (unknown usernames included — same generic
`invalid_credentials`, no enumeration). The per-IP `loginPerIp` volumetric cap
still bounds an IP sweeping many usernames. Unlike the volume caps, backoff delays
are **not** `perMachineMax`-divided — each machine applies the full delay. The
`unverified` branch (correct password) does **not** count as a backoff failure.

The same primitive also gates **bot invocation**
(`src/rate-limit/bot-rate-limit.ts`, `BOT_LIMITS`, per `(user, bot)`) and
**message send** (`src/rate-limit/message-rate-limit.ts`, `MESSAGE_LIMITS`, per
user): the WS `handleSend` checks it before persisting, and over the cap replies
`error{code:'rate_limited', clientMessageId}` (socket stays open) and stores
nothing. The fourth surface, **username lookup**
(`src/rate-limit/username-lookup-rate-limit.ts`, `USERNAME_LOOKUP_LIMITS`, per
caller account **and** per-IP over a 10-min window), gates the human-peer
resolution in `POST /conversations`: a human peer is addressed by exact username,
so an unbounded caller could enumerate accounts. The route checks it (human peers
only — bot ids resolve against the in-process registry, not a lookup) **before**
the DB hit and over the cap returns **429** `rate_limited`.

**Global caps across the fleet.** The numbers in `AUTH_LIMITS`/`BOT_LIMITS` are
**global** (whole-fleet) caps per window, not per-machine. Because the counter is
**in-memory per process**, N machines each counting independently would otherwise
let the true cap be N× the intended value (and an attacker just floods — the load
balancer spreads requests, so they get the extra allowance without knowing N;
`auto_start_machines` can even raise N under load). To approximate a global cap
without a shared store, `perMachineMax(globalMax)` (`src/rate-limit/rate-limiter.ts`)
divides each cap by **`RATE_LIMIT_MACHINE_COUNT`** (env, default 1): each machine
enforces `ceil(globalMax / N)`, so the fleet sums to ~the global cap.

- **Calculating it.** Set `RATE_LIMIT_MACHINE_COUNT` to the number of machines you
  run (`fly scale count`). Effective global cap = `N × ceil(G/N)` ≈ `G` — slightly
  *over* (ceil rounding adds up to `N−1`; a cap `G < N` floors at 1/machine, giving
  `N`). It's never *under* `G`, so legit users are never wrongly blocked. At one
  machine (default) the cap is exact. To allow more traffic as capacity grows,
  raise the global numbers in `AUTH_LIMITS`/`BOT_LIMITS`.
- **Keep N in sync with reality.** With `auto_start_machines = true`, the *live*
  machine count can exceed `RATE_LIMIT_MACHINE_COUNT`, weakening the cap — set it
  to your max provisioned count (or pin `fly scale count`). NB: the in-process WS
  `hub` already requires effectively one machine until it moves to pub/sub, so v1
  runs `N = 1` and the cap is exact.
- **Remaining follow-ups:** the **exact** fix is a shared store (Redis/Postgres
  atomic counters) which removes the division entirely (and naturally rides the
  hub→pub/sub move). (The §6 **exponential backoff** for repeated failure now
  exists for login — see `FailureBackoff` above; the *volumetric* windows are
  still fixed, which is the right shape for them.)

#### Conversations & messages (§2/§3/§4)

All routes require a session (`requireSession` preHandler in
`src/auth/guards.ts`, which attaches `request.authUser`); state-changing routes
also require the double-submit CSRF token (`requireCsrf`). Backing tables:
`conversations` + `conversation_participants` (migration 004), `messages` + a
per-participant last-seen cursor (migration 005).

- `GET /conversations` — the caller's list (`ConversationListResponse`), newest
  first; each row carries peer, last-message preview, and unread count.
- `GET /conversations/:id` — one summary (`ConversationResponse`); 404 (generic)
  when it's absent or the caller isn't a participant.
- `GET /conversations/:id/messages?before=<id>&limit=<n>` — backward history page
  (`MessagePage`), oldest-first within the page; `before` is a prior page's
  `nextBefore` cursor.
- `POST /conversations/:id/read` `{ messageId }` — advance the last-seen cursor
  (§7); `204`. CSRF-protected.
- `POST /conversations` `{peerKind:'human',username}` or `{peerKind:'bot',botId}`
  — start or fetch (idempotent) the conversation with a peer (`StartConversationResponse`);
  generic `not_found` for an unaddressable peer (unknown/unverified user, self,
  unknown bot). CSRF-protected.
- `DELETE /conversations/:id` — hide the conversation from the caller's list (the
  peer is unaffected; new activity un-hides it, migration 006 `hidden` flag);
  `204`. CSRF-protected.
- `GET /bots` — the system bot registry (`BotListResponse`, from
  `src/bots/registry.ts`).

```bash
curl -s -b "$JAR" http://localhost:8080/conversations
curl -s -b "$JAR" http://localhost:8080/conversations/$CONV
curl -s -b "$JAR" "http://localhost:8080/conversations/$CONV/messages?limit=50"
CSRF=$(awk '$6=="csrf_token"{print $7}' "$JAR")
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" -X POST \
  http://localhost:8080/conversations/$CONV/read \
  -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
  -d "{\"messageId\":\"$MSG\"}"
```

Peers resolve to the other human or a system bot (`src/bots/registry.ts`).
A message's `sender_id` is the human's account id or a bot slug.

#### WebSocket messaging (§3)

`ws://…/ws` — the upgrade requires the **session cookie + a same-origin `Origin`
header** (§6); otherwise it's refused (401/403). Frame envelopes live in
`@chatapp/shared` `ws.ts`. The client sends `{type:'send', conversationId,
clientMessageId, content}`; the server:

- replies on the originating socket with **`ack`** (the persisted message +
  `clientMessageId`),
- fans the message out to the other participant sockets **and the sender's other
  tabs** as **`message`** (with `clientMessageId` nulled),
- sends the sender a **`delivered`** receipt when a human peer socket received it,
- returns **`error{code, clientMessageId}`** on a bad/forbidden frame (the socket
  stays open).

Messages get a server-assigned `createdAt` (the §3 ordering key) and are
idempotent on `(sender_id, clientMessageId)` — a retry re-acks the same message
without duplicating or re-broadcasting. Live sockets are tracked per account in
`src/ws/hub.ts` (in-process; move behind a pub/sub before running multiple
machines). A send into a **bot** conversation streams a reply: after the user
message is persisted + acked, the orchestrator (`src/bots/orchestrator.ts`) emits
`bot_start` → `bot_chunk*` → `bot_end` (or `bot_error{code}`) and persists the
reply as a message from the bot. Replies come from a pluggable provider
(`src/bots/provider.ts`): **Anthropic** (`@anthropic-ai/sdk`, default model
`claude-opus-4-8`) or **OpenAI** (`openai`, default `gpt-4o`), chosen by
`BOT_PROVIDER` **and** the matching API key; with neither key set it falls back to
the **stub** placeholder (so dev and tests run keyless, like the email sender when
`RESEND_API_KEY` is unset). Models are overridable via `ANTHROPIC_MODEL` /
`OPENAI_MODEL`; thinking is off and there's no prompt caching (the per-bot system
prompt is below the cache minimum). A provider failure throws a `BotError` whose
`code` rides the `bot_error` frame — `botErrorCodeSchema` in `@chatapp/shared`:
`provider_unavailable` (upstream/model error), `budget_exceeded` (§cost token
budget, below), or `internal_error` (anything else).

**Token budget (§cost).** Each user has a per-UTC-day bot token budget
(`BOT_DAILY_TOKEN_BUDGET`, default 20,000; input + output) tracked in the
`bot_usage` table (migration 007, one counter row per account/day) via
`src/bots/budget.ts`. The orchestrator **checks before** the model call — if the
human participant is at/over the cap it emits `bot_error{code:'budget_exceeded'}`
(after `bot_start`, so the client correlates it by messageId) and persists
nothing — and **records after** a successful reply, adding the provider-reported
usage (`streamReply` returns `BotUsage` after its deltas: Anthropic
`finalMessage().usage`, OpenAI `stream_options.include_usage`, the stub a length
estimate). Soft fixed-window like the auth rate-limiter: the reply that crosses
the cap completes, the next is blocked; counters persist across restarts.

**Invocation rate limit (§3/§6).** Separate from the daily token budget, a
per-`(user, bot)` burst guard caps how fast bot replies can be requested
(`src/rate-limit/bot-rate-limit.ts`, `BOT_LIMITS.invoke` = 20/60s placeholder,
reusing the shared `RateLimiter`). Checked in the orchestrator **before** the
budget (in-memory, cheaper than the DB read) and before any model call; over the
limit emits `bot_error{code:'rate_limited'}` (after `bot_start`) and persists
nothing. In-memory per-process (same shared-store caveat as auth).

### Database scripts & migrations

- `npm run db:down` (stop), `npm run db:reset` (drops the volume — **wipes all
  data**; re-run `migrate` afterward), `npm run db:logs`.
- Migrations are plain `.sql` files in `src/db/migrations/`, applied in filename
  order and tracked in `schema_migrations`. Add a new forward migration rather
  than editing an applied one.

### Tests

[Vitest](https://vitest.dev), matching `apps/web`. Tests are `*.test.ts`
co-located under `src`. The change gate is **typecheck + test + build**:

```bash
npm run typecheck -w @chatapp/server
npm run test -w @chatapp/server      # or `npm test` to run every workspace
npm run build -w @chatapp/server
```

- **Unit tests** (`src/auth/*.test.ts`) cover the pure primitives (CSRF compare,
  token hashing, password hash/verify) — no I/O.
- **Integration tests** (`src/routes/auth.test.ts`) drive the full signup →
  login → me → logout flow (the curl flow above) via Fastify's in-process
  `app.inject()`.
- The suite needs Postgres running (`npm run db:up`). Integration tests use a
  **separate `chatapp_test` database**, provisioned and migrated automatically
  by `src/test/global-setup.ts`, so they never touch your dev data. Tables are
  truncated between tests.
- `npm run test:watch -w @chatapp/server` for watch mode. The build excludes
  test files via `tsconfig.build.json`, so they never ship in `dist`.

## Hosting

- Fly.io app, region `iad` for v1. See [`fly.toml`](../../fly.toml) at the repo root.
- **Pinned to one machine (`N = 1`)** — the in-process rate-limit counters and WS
  `hub` aren't shared across machines yet. The plan to scale out (Redis-backed
  counters + pub/sub fan-out, phased) is scoped in
  [`docs/multi-machine.md`](../../docs/multi-machine.md).
