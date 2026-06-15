# ChatApp

A privacy-first web chat application supporting 1-on-1 conversations between users and with LLM-backed bots.

See [REQUIREMENTS.md](./REQUIREMENTS.md) for the full requirements specification.

## Status

**v1 complete and deployed.** Auth (signup, email verification, password reset,
sessions, CSRF), 1-on-1 human↔human messaging over WebSocket, LLM-backed bots
(Anthropic / OpenAI), Web Push, account deletion, and data export are all built —
see [REQUIREMENTS.md](./REQUIREMENTS.md) for the full spec.

### Live demo

A hobby instance runs on Fly.io: **https://furiousnacho-chat.fly.dev**

> ⚠️ **Best-effort demo — may be down at any time.** It runs on a single
> auto-stopping machine, so it can be cold-starting (a few seconds on first
> request), temporarily down, or taken offline without notice. Don't rely on it.
> To run your own, see the deployment notes in
> [`apps/server/CLAUDE.md`](./apps/server/CLAUDE.md#hosting).
