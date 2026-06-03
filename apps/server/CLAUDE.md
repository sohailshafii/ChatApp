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

## Hosting

- Fly.io app, region `iad` for v1. See [`fly.toml`](../../fly.toml) at the repo root.
