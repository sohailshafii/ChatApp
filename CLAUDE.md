# ChatApp — Repo Orientation

A small monorepo for a web chat application. The full v1 spec is in [REQUIREMENTS.md](./REQUIREMENTS.md).

**Status:** v1 complete and deployed — running in production on Fly.io, scaled
horizontally across multiple machines (Redis/Valkey-backed shared state). See
[README.md](./README.md) for details.

## Workspaces

- **`apps/web`** — React + Vite frontend (TypeScript).
- **`apps/server`** — Node + TypeScript backend (REST + WebSocket).
- **`packages/shared`** — TypeScript types and schemas shared between web and server.

## Agent domains

This repo is structured so Claude sessions can work on the frontend and backend in parallel.

- A web-focused session should be started from `apps/web` and pick up its `CLAUDE.md`.
- A server-focused session should be started from `apps/server` and pick up its `CLAUDE.md`.
- Changes to `packages/shared` affect both apps — coordinate via small PRs and update consumers in the same PR.

## Tooling

- **npm workspaces** (no Turbo, no Nx — kept deliberately lean).
- **TypeScript** strict mode everywhere.
- **Fly.io** for hosting, with Fly Postgres for the SQL store. See "Decisions" in REQUIREMENTS.md.

## Common commands

```bash
npm install              # install all workspace deps
npm run dev:web          # run the Vite dev server
npm run dev:server       # run the backend in dev mode
npm run typecheck        # typecheck all workspaces
```

## Conventions

- Wire-format types live in `packages/shared` so client and server can't drift.
- Don't add ESLint, Prettier, test framework, or CI scaffolding speculatively — add when the first real need arises.
- Per the spec, message content max is **20,000 characters** (REQUIREMENTS.md §3).
- **PRs are squash-merged.** Each merged PR collapses to a single commit on `main`
  (its individual commits are squashed away), so `main`'s history reads as one
  entry per PR — a clean, reviewable changelog. Keep PRs focused and write a clear
  PR title/description, since that becomes the permanent log entry.
