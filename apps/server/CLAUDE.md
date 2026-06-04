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
`RESEND_API_KEY`; a missing required var fails fast at startup. (Production on Fly
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
copy the `?token=…` URL. Inspect the persisted rows directly:

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
`SELECT account_id, last_active_at FROM sessions;`.

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

#### Rate limiting

Auth endpoints are rate limited (§6) by a single in-memory primitive in
`src/rate-limit/`. `signup`, `login`, `verify-email/resend`, and
`password-reset/request` are capped **per-IP** (and **per-account** where the
body carries an identifier) over a 10-minute window; exceeding a cap returns
**429** with `{"error":{"code":"rate_limited",…}}`. Limits live in `AUTH_LIMITS`.

Two known simplifications (follow-ups): the store is **per-process** — move it to
a shared store (Redis/Postgres) before running multiple machines — and it is a
fixed window, not the §6 exponential backoff. The same primitive should later
cover username lookup, message send, and bot invocation.

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
machines). Bot reply streaming (`bot_start`/`bot_chunk`/`bot_end`) is in the
protocol but produced by the bot-orchestration work — a send into a bot
conversation is persisted + acked, with no reply yet.

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
