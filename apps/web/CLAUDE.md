# `apps/web` — Frontend

React + Vite + TypeScript client for ChatApp. Full spec: [`../../REQUIREMENTS.md`](../../REQUIREMENTS.md).

## Scope

- UI components, routing, state management.
- WebSocket client and reconnect logic.
- Push subscription registration (service worker).
- Auth flow (login, signup, email verification, password reset).

## Out of scope

**Do not modify `apps/server` or `packages/shared` from this workspace** without explicit coordination. If a wire-format change is needed, surface it as a shared-types task before touching the backend.

## Tech

- **React 18+** with function components and hooks.
- **Vite** for dev/build.
- **TypeScript** strict mode.
- Wire types imported from `@chatapp/shared`.

## Local development

All commands run from the **repo root**. Install once with `npm install`.

### Build & typecheck (the test gate)

Every change must pass typecheck, unit tests, and a production build:

```bash
npm run typecheck --workspace=@chatapp/web   # tsc --noEmit, strict
npm run test --workspace=@chatapp/web        # vitest run (use test:watch while developing)
npm run build --workspace=@chatapp/web       # vite build; also prints the gzipped bundle size
```

The build output reports the gzipped JS size — keep the app shell **≤ 300 KB
gzipped** (see Conventions). Treat a regression past the budget as a bug.

**Tests** use **Vitest** (added when unit tests were first needed — see root
CLAUDE.md). They live next to the code as `*.test.ts` and run in a Node
environment; `vitest.config.ts` holds the config. Pure logic (e.g. the API
client) is tested by stubbing `fetch`/`document` — no jsdom. If component tests
arrive, add a DOM environment (jsdom/happy-dom) at that point rather than now.

### Run the app in a browser

The web app calls `/auth/*` on its own origin and Vite proxies those to the
backend, so cookies stay first-party. To see the app working end-to-end you need
Postgres + the server + the web dev server. Backend details live in
[`../server/CLAUDE.md`](../server/CLAUDE.md); the full loop:

```bash
# 0. One-time: create the local env file (gitignored; defaults match compose.yml).
cp .env.example .env

# 1. Start Postgres (needs the Docker daemon running) and apply migrations:
npm run db:up
npm run migrate --workspace=@chatapp/server

# 2. In one terminal, run the backend (listens on :8080):
npm run dev:server

# 3. In another terminal, run the web dev server (listens on :5173):
npm run dev:web
```

Then open **http://localhost:5173**. Notes:

- Unauthenticated visitors are redirected to **`/login`** (the home route is
  guarded). Create an account at **`/signup`**.
- To verify an account, grab the verification link from the **server console**
  (the `dev:server` terminal): the server logs the `/verify-email?token=…` URL
  there. Copy it into the browser to complete verification. The Resend email
  client isn't wired up yet, so **the link is always logged and no email is sent
  in any environment for now** — even with `RESEND_API_KEY` set. (Once Resend is
  wired, a configured key will send for real; dev without a key will keep
  logging.)
- Stop the stack with `npm run db:down` (keeps data) or `npm run db:reset`
  (wipes the volume); stop the dev servers with Ctrl-C.

## App flow (auth → conversation list)

The post-login / page-load sequence, per REQUIREMENTS.md §2 and §7:

1. **Bootstrap.** On load, `AuthProvider` (`src/auth/AuthContext.tsx`) calls
   `GET /auth/me`. `status` is `loading` → `authenticated` | `unauthenticated`
   (the session cookie is httpOnly, so the server is the source of truth).
2. **Routing on auth.** `RequireAuth` gates the app home (`/`) and redirects
   unauthenticated users to `/login` (remembering the attempted path);
   `RedirectIfAuthed` keeps authenticated users off `/login` and `/signup`.
3. **Land on the conversation list.** A successful login seeds the session and
   navigates to `/`, whose index route is the **conversation list** (`HomePage`),
   which fetches `GET /conversations` on mount (§2). This is the home view.
4. **Realtime (later, §3).** Per §7, after the initial REST load the client opens
   a **WebSocket** for live delivery. Not built yet.

Current shape vs. §7: §7 frames login/page-load as fetching initial state as a
unit (profile **and** conversation list). Today those are **two independent
fetches** — `AuthContext` (`/auth/me`) and `HomePage` (`/conversations`) — which
is fine for now; revisit if a unified initial-state endpoint or a shared store
becomes warranted. The WebSocket step is still pending.

## Conventions

- Bundle budget: **≤ 300 KB gzipped** for the app shell (REQUIREMENTS.md non-functional). Treat regressions as bugs.
- WCAG 2.1 AA accessibility from the start.
- Keep state management lean — Context or a small store (Zustand) for v1 unless something more is genuinely warranted.
