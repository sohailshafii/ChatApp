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

### Database scripts & migrations

- `npm run db:down` (stop), `npm run db:reset` (drops the volume — **wipes all
  data**; re-run `migrate` afterward), `npm run db:logs`.
- Migrations are plain `.sql` files in `src/db/migrations/`, applied in filename
  order and tracked in `schema_migrations`. Add a new forward migration rather
  than editing an applied one.

## Hosting

- Fly.io app, region `iad` for v1. See [`fly.toml`](../../fly.toml) at the repo root.
