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

## Local development (database)

Postgres runs in Docker via [`compose.yml`](../../compose.yml) at the repo root.
The npm scripts assume the Docker **daemon** is already running — start Docker
Desktop / Colima / OrbStack first, then:

```bash
# 1. Start the Docker daemon (Docker Desktop: `open -a Docker`, then wait for it).
# 2. From the repo root:
npm run db:up        # docker compose up -d postgres
npm run migrate -w @chatapp/server   # apply pending SQL migrations
```

- Config comes from env (`.env` at the repo root; copy `.env.example`). The
  server reads `DATABASE_URL`, `PORT`, `APP_BASE_URL`, and optional
  `RESEND_API_KEY` — see [`src/config.ts`](./src/config.ts).
- Other DB scripts: `npm run db:down`, `npm run db:reset` (drops the volume),
  `npm run db:logs`.
- Migrations are plain `.sql` files in `src/db/migrations/`, applied in filename
  order and tracked in `schema_migrations`. Add a new forward migration rather
  than editing an applied one.
- When `RESEND_API_KEY` is unset, signup logs the verification link instead of
  emailing it, so the flow is testable without a mailbox.

## Hosting

- Fly.io app, region `iad` for v1. See [`fly.toml`](../../fly.toml) at the repo root.
