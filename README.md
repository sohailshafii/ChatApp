# ChatApp

A privacy-first web chat application supporting 1-on-1 conversations between users and with LLM-backed bots.

See [REQUIREMENTS.md](./REQUIREMENTS.md) for the full requirements specification.

## Status

**v1 complete and deployed.** Auth (signup, email verification, password reset,
sessions, CSRF), 1-on-1 human↔human messaging over WebSocket, LLM-backed bots
(Anthropic / OpenAI), Web Push, account deletion, and data export are all built —
see [REQUIREMENTS.md](./REQUIREMENTS.md) for the full spec.

### Scaling

The app runs **horizontally across multiple Fly machines** — verified in
production at two machines (cross-machine messaging, presence, and bot streaming
all confirmed live). The state that must be shared across machines — rate-limit
counters, presence ("who's connected, on which machine"), real-time message
fan-out, and background-job leadership — is backed by a small self-run
**[Valkey](https://valkey.io)** (Redis-compatible) app on Fly's private network.
With no `REDIS_URL` configured the app falls back to in-process state and runs as a
single machine, so local dev and small deployments need no extra infrastructure.
The design and phased rollout are in
[`docs/multi-machine.md`](./docs/multi-machine.md); the Valkey app is in
[`valkey/`](./valkey).

**Why self-run Valkey instead of a managed, per-command Redis.** A chat app's
heaviest Redis traffic isn't messages — it's the steady drip of **presence
heartbeats from every open tab**, plus pub/sub fan-out: a high, *constant* command
rate even when little is being said. On pay-per-command managed Redis (e.g.
Upstash), that constant rate dominates the bill — a handful of always-connected
users can reach tens of millions of commands per month. A flat-cost Valkey machine
(a ~$2–3/mo `shared-cpu-1x`) absorbs all of it for a fixed, predictable price as
connections grow. Everything reaches Valkey through the single `REDIS_URL` secret,
so switching to a managed provider later is a one-line change if that trade-off
ever flips.

### Live demo

A hobby instance runs on Fly.io: **https://furiousnacho-chat.fly.dev**

![Furious Nacho, the ChatApp mascot, erupting in lightning while football fans flee a living room](./docs/images/furious-nacho-cover.jpg)

> ⚠️ **Best-effort demo — may be down at any time.** It runs on auto-stopping
> machines, so it can be cold-starting (a few seconds on first request),
> temporarily down, or taken offline without notice. Don't rely on it.
> To run your own, see the deployment notes in
> [`apps/server/CLAUDE.md`](./apps/server/CLAUDE.md#hosting).

> 🔑 **Signup is invite-only — you can't self-register.** The demo runs in
> invite-only mode, so creating an account requires an invite minted by the
> operator. There's no self-serve signup; reach out and I'll issue one for your
> email address.
>
> Self-hosted instances allow **open signup by default**. Operators opt into
> invite-only with `INVITE_ONLY=true` and mint invites with
> `npm run invite -- <email>` (see [`apps/server/CLAUDE.md`](./apps/server/CLAUDE.md)).
