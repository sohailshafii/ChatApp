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

## Conventions

- Bundle budget: **≤ 300 KB gzipped** for the app shell (REQUIREMENTS.md non-functional). Treat regressions as bugs.
- WCAG 2.1 AA accessibility from the start.
- Keep state management lean — Context or a small store (Zustand) for v1 unless something more is genuinely warranted.
