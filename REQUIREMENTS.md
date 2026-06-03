# ChatApp — Requirements

A privacy-first chat application in the spirit of iMessage (or something similar). Web-first; native clients deferred.

## Overview

ChatApp is a real-time messaging application that prioritizes user privacy and a small, well-defined surface area. The MVP targets the web; iOS and other native clients are explicitly out of scope for v1.

## Goals

- Sensible privacy and security defaults (TLS in transit, at-rest encryption, minimal metadata retention).
- A small, well-defined MVP that is shippable and demoable.
- A clean foundation that can grow into groups, calls, native clients, and stronger key models without rework.

## Non-goals (v1)

- Native mobile or desktop applications.
- Group chats, voice/video calls, status/stories.
- True end-to-end encryption (Signal-style, device-bound keys). v1 uses transport + at-rest encryption with the server holding keys, so an account can log in from any browser and see its history. 2FA and stronger key models are deferred to a later hardening pass.
- Federation / interoperability with other messaging networks.

## MVP scope

The MVP supports authenticated 1-on-1 conversations. The other party in a conversation may be either:

- **a human peer** — another registered user, or
- **a bot peer** — an LLM-backed service (OpenAI or Claude).

The two share the same UI, transport, and storage; they differ only in how the "other side" produces replies. Conversation history is persisted server-side and is available after re-login from any browser.

## Functional requirements

Each section is a placeholder. We'll fill these in one at a time.

### 1. Accounts & Identity

**Signup.** A user provides a username, an email, and a password.

- Username is the primary login identifier and is also visible to other users in the app.
- Email is used only for auth-related communication (verification, password reset, security notices). It is not exposed to other users.
- Username constraints: 3–30 characters, `[a-z0-9_-]`, case-insensitive uniqueness (stored lowercased; original casing preserved for display).
- Email is unique per account.
- Password: minimum 8 characters, no forced composition rules (current NIST guidance). Stored hashed with **argon2id**.

**Email verification.** On signup, the server emails a one-time, time-limited link (24h expiry) to the provided address. The account exists in an unverified state and cannot log in until the link is clicked. A user can request the verification email to be re-sent.

**Login.** User submits **username + password**. On success the server issues an opaque session token and sets it on the browser as an **httpOnly, Secure, SameSite=Lax** cookie.

- Token lifetime: 30 days, sliding (each authenticated request extends it).
- Multiple concurrent sessions per account are allowed (different browsers / devices).
- Logout deletes the session server-side and clears the cookie.

**Password reset.** User requests a reset by entering either their username or their email. The server sends a one-time, time-limited reset link (1h expiry) to the account's email. Completing a reset sets the new password and **invalidates all existing sessions** for that account.

### 2. Conversations & Peers

A user's home view is a **conversation list** spanning both kinds of peers, sorted by most recent activity. Each entry shows the peer's display name (username for humans, bot name for bots), a last-message preview, a timestamp, and an unread indicator.

**Starting a conversation with a human peer.**
- The user enters the exact username of the person they want to chat with. No fuzzy search and no directory browse in v1.
- If the username exists and is verified, a conversation is created and appears in both users' conversation lists. The initiator can send the first message immediately — there is no acceptance step in v1.
- If the lookup fails, the response is generic ("no such user") and does not distinguish "doesn't exist" from "exists but unverified," to limit username enumeration.

**Starting a conversation with a bot peer.**
- The user picks a bot from a **system-curated list** configured server-side. Users cannot create custom bots in v1.
- Selecting a bot creates a new conversation with that bot as the peer. Each user has their own private conversation with each bot; bots have no shared inbox across users.

**Conversation identity.**
- A human–human conversation is uniquely identified by the unordered pair of users. A user–bot conversation is uniquely identified by (user, bot). A user cannot have two parallel conversations with the same peer.

**Leaving / hiding a conversation.** A user can remove a conversation from their list. Their copy of the history is hidden (retention semantics live in §4). For human peers, the other party still sees the conversation; for bot peers, the user's own state is the only state.

### 3. Messaging

**Transport.** While a tab is open, an authenticated client maintains a **WebSocket** to the server for real-time delivery. Initial state (conversation list, recent history) is fetched via REST on page load.

**Message content (v1).** Plain text only, including line breaks. **Max 20,000 characters** per message (Unicode code points; length validated client-side and re-validated server-side). Matches iMessage's limit and keeps a single user turn under roughly 4k tokens for bot conversations. URLs are detected and rendered as clickable links; no link previews. No images, files, voice notes, or rich formatting.

**Sending a message.**
1. Client submits the message with a client-generated `clientMessageId` (for idempotent retry).
2. Server validates, persists, assigns a server timestamp and message ID, and ACKs the sender.
3. Sender's UI moves the message from `sending` → `sent`, deduping against the eventual broadcast via `clientMessageId`.

**Delivery to human peers.**
- Server broadcasts the new message to all of the recipient's currently-connected sockets (a recipient with three tabs open sees it in all three).
- If the recipient has no open sockets, the message is still persisted and appears on next page load.
- Within a conversation, messages are ordered by **server-assigned timestamp**. Client clocks are not trusted for ordering.

**Status indicators (v1).**
- **Sent** — server has persisted the message (single check).
- **Delivered** — at least one of the recipient's sockets has received it (double check).
- **Read receipts** — *deferred*. If added later, off by default.
- For **bot conversations**, only `sent` applies to user messages; bot replies have no status indicator.

**Bot replies.**
- On receiving a user message in a bot conversation, the server persists the user message, then issues a request to the bot's configured model endpoint (OpenAI or Anthropic).
- The request includes a server-configured **system prompt** and the recent conversation history, trimmed to fit a model-specific token budget. The bot does not have unbounded long-term memory in v1.
- The streamed model response is forwarded over the user's socket as chunks arrive; the assistant message is persisted in full once the stream completes.
- If the user has no open socket while the bot is replying, the reply still completes server-side and is shown on next connect.
- **Per-user, per-bot rate limits** apply (concrete numbers under non-functional requirements) to bound cost.

**Failure modes.**
- Send failure (network / transient): client retries with the same `clientMessageId`; UI shows `sending…` then `failed` with a manual retry option if automatic retries are exhausted.
- Bot reply failure (model API error / timeout): the user message is preserved; an in-conversation error marker replaces the assistant reply; the user can retry the send.

### 4. Message Persistence & History

**What is stored.**
- All messages from all conversations (human–human and user–bot), indefinitely, until explicitly deleted.
- Conversation metadata: participants, created-at, last-message timestamp.
- Per-user state: hidden flag (§2), unread count, last-read marker.

**Storage model.**
- A conversation has **one canonical message history** referenced by its participants. Hiding a conversation (§2) flips a per-user flag and does not mutate the canonical history; if the user reopens the conversation with the same peer (or a new message arrives in it), the history reappears intact.
- Messages are encrypted at rest by the storage layer; the server holds the keys (consistent with §6).

**Loading history.**
- On opening a conversation, the client loads the **most recent 50 messages** via REST.
- Scrolling up loads older pages via **cursor-based pagination** (cursor = server timestamp + message ID), 50 per page.
- New incoming messages arrive via WebSocket and are appended live.

**Cross-browser consistency & catch-up.**
- The server maintains, per `(user, conversation)`, a **last-seen cursor** — the ID and server timestamp of the most recent message that user has acknowledged seeing. This cursor is the single source of truth for "what's new" on any client.
- On login from any browser, the client loads the conversation list with each conversation's last message and the user's last-seen cursor. Conversations with messages newer than the cursor are flagged unread, with an unread count.
- On opening a conversation, the client fetches messages relative to the cursor (those after, plus a window of older messages for context) and advances the cursor as the user views new messages.
- All concurrent sessions of the same account share this cursor, so reading a message on one device clears the unread indicator on the others.

**Retention.** v1 retention is **indefinite**, until the user explicitly deletes their account (§6). Per-message and per-conversation deletion are deferred (§3).

**Account deletion impact.**
- On deletion, the user's profile is anonymized (display name → "Deleted user"); their sent messages remain in their peers' histories so the peer's view of the past conversation stays intact.
- The deleted user's **bot conversations are hard-deleted** along with the account (no other party has a stake in them).

### 5. Notifications

A user should learn about a new incoming message in proportion to how reachable they currently are: instantly in-tab, visibly across browser chrome when looking elsewhere, and via the OS when the browser is closed.

**State A — Tab open, conversation focused.**
- The message renders in the live view (§3). The conversation jumps to the top of the list with the latest preview.
- No additional surface required.

**State B — Tab open, different conversation focused.**
- The relevant conversation row shows an **unread count badge** and bumps to the top.
- A short, subtle sound plays on incoming (default-on; mute toggle deferred).

**State C — Tab open but not visible (user is on a different browser tab or window).**
- The tab title updates to `(N) ChatApp`, where N is the total unread count across conversations.
- The favicon shows an unread dot.
- If the user has granted notification permission, an OS-level notification fires via the **Notification API** (does not require a service worker).

**State D — Tab closed.**
- A **Web Push** notification is dispatched via a service worker and the Push API. This requires: a registered service worker, a VAPID-keyed push subscription per browser/device, and a server-side push dispatcher that fires when the recipient has no active WebSocket sessions.
- Clicking the push opens the relevant conversation.

**Notification content.**
- Title: sender's username (human peer) or bot name (bot peer).
- Body: truncated preview of the message (first ~100 characters).
- "Hide content" / sender-only toggle is deferred; v1 shows the preview by default.

**Permission flow.**
- The app does **not** prompt for notification permission on first load (anti-pattern, gets denied).
- A contextual prompt ("Get notified when offline") is offered after the user's first send or receive, and via a settings toggle the user can enable anytime.
- Declining is fine: in-tab badges, tab title, and favicon work without permission.

**Bot conversations.** Bot replies follow the same notification model. In practice the bot typically replies during an active session so the in-tab path covers it; the push path only matters if the user closes the tab mid-stream.

### 6. Security & Privacy

**Transport.** HTTPS for REST, WSS for WebSocket. TLS 1.2 minimum (1.3 preferred). HSTS on production hosts. The WebSocket upgrade verifies the `Origin` header against the allowed app origin.

**At-rest.** Stored messages and account records are encrypted at rest by the storage layer (e.g., managed-DB encryption). The server holds the keys. This is a baseline protection against disk theft and backup leaks, not a privacy claim against the operator — see "what the server can see" below.

**Password storage.** `argon2id` (per §1) with per-password salts (built in). Cost parameters tuned to ~250 ms verify time on production hardware; reviewed periodically.

**Session security & CSRF.**
- Session token in an httpOnly + Secure + SameSite=Lax cookie (§1) covers CSRF for top-level navigations.
- State-changing endpoints additionally require a **double-submit CSRF token**: a non-HttpOnly cookie value echoed via a request header. Protects fetch-issued requests where SameSite=Lax alone is insufficient.
- WebSocket upgrade requires the session cookie and verifies `Origin`.

**XSS prevention.**
- Strict **Content Security Policy**: scripts limited to the app origin, no inline scripts (nonces/hashes if required).
- User-supplied content (messages, usernames) is rendered through a framework that escapes by default; no raw HTML insertion.
- URL auto-linking accepts `http(s)://` only; `javascript:`, `data:`, and similar schemes are not linkified.

**Rate limiting.**
- Auth endpoints (signup, login, password reset, verification resend): per-IP and per-account, with exponential backoff on repeated failure.
- Username lookup (starting a conversation by username): per-IP — generic error alone doesn't prevent enumeration, rate limiting does.
- Message send: per-user, to bound flooding.
- Bot invocation: per-user, per-bot (also referenced in §3) to bound cost.

**Audit logging.**
- Per-account log of auth events: login, login failure, password change, password reset, account deletion, push subscription creation/removal.
- A user-facing "recent activity" view is deferred; the underlying log exists from v1 so it can be surfaced later.
- Operational logs do **not** contain message content. PII (email, IP) in operational logs has a bounded retention window (~30 days); auth audit logs are kept longer (~180 days).

**Account deletion.**
- User-initiated; requires re-entering the password to confirm.
- v1 performs an **immediate hard delete** of the account, which:
  - Anonymizes the user's display in human-conversation histories (per §4: shown as "Deleted user"; peer's message copies are retained).
  - Hard-deletes user-bot conversations belonging to the account.
  - Deletes session tokens and push subscriptions.
- Soft-delete with a grace period is deferred.

**Data export.**
- A user can request an export of their own data: profile, conversation metadata, and full message content from their conversations.
- Generated **asynchronously**; delivered as a downloadable archive via a time-limited email link.

**Third-party data flow (bot peers).**
- Messages in a bot conversation are sent to the configured model provider (OpenAI, Anthropic). Provider privacy policies apply to that data.
- Disclosed to the user when starting a bot conversation. Bot conversations cannot be made opaque to the provider — the model needs plaintext to respond.
- Only the bot conversation's own history is forwarded. Content from the user's other conversations is never included.

**What the server can see (transparency).** In v1, message content and metadata are server-readable, since true E2E is a non-goal. Stated up-front so user-facing copy elsewhere does not over-promise. Operator access to production data should be restricted to a small set of accounts and logged.

**Secrets handling.** Secrets (VAPID private key, bot-provider API keys, DB credentials, mailer credentials) are kept in a secrets manager or environment-injected store, never in source. Rotation procedures exist for VAPID and provider keys.

**Age.** Minimum age 13 (COPPA baseline), enforced via signup attestation.

### 7. Sync & Session

This section ties together the behavior of a session over its lifetime: opening a tab, refreshing, losing and regaining the network, opening additional tabs, and logging out. Underlying primitives are referenced rather than restated — session token in §1, WebSocket in §3, last-seen cursor in §4.

**Tab open.**
- On page load, the client reads the session cookie, fetches initial state via REST (account profile, conversation list with last-seen cursors), then opens a WebSocket.
- An open WebSocket is bound to its session row server-side; the server tracks `(session_id, socket_id)` so it can fan messages out and update presence (presence subsystem in Infrastructure TODO).

**Refresh.**
- The session cookie survives the refresh. The page repeats the open flow: REST for initial state, then a new WebSocket. No re-authentication.
- The catch-up cursor (§4) lives server-side, so unread state is consistent across refreshes.

**Multiple tabs in the same browser.**
- Each tab opens its own WebSocket; the server treats them as N independent sockets bound to the same session.
- Cross-tab state sync (e.g., reading a message in tab A clearing the unread badge in tab B) goes through **server broadcast**: every state-changing action is sent to the server, which fans the resulting event to all of the user's open sockets.
- No client-side cross-tab IPC (BroadcastChannel, etc.) is required in v1; tabs converge on the same view through the server.

**Network drop / reconnect.**
- On socket close, the client retries with **exponential backoff and jitter** (start ~1 s, cap ~30 s).
- A "Reconnecting…" indicator surfaces in the UI while the socket is down so the user understands real-time delivery is paused.
- On reconnect, the client requests messages since the last-seen cursor for the focused conversation and refreshes the conversation-list summaries. Messages persisted server-side during the gap are delivered through the same fan-out as live messages.

**Sending while disconnected.**
- A message composed and submitted while the socket is reconnecting is queued client-side with its `clientMessageId` (§3) and flushed on reconnect; UI shows `sending…`.
- If the session cookie has expired (no activity for 30 days), the send fails and the user is prompted to log back in. Queued messages survive re-login within the same tab; closing the tab loses them.

**Session token lifecycle (recap of §1).**
- Opaque server-issued token in an httpOnly cookie.
- 30-day sliding expiry; each authenticated request updates `last_active_at` on the session row.
- A background sweeper deletes session rows whose `last_active_at` is older than 30 days.

**Logout.**
- **Log out (current session):** deletes the session row, clears the cookie, closes this browser's WebSockets. Concurrent sessions in other browsers are untouched.
- **Password reset (§1)** invalidates all of an account's sessions — effectively "log out everywhere" as a side effect.
- A standalone "Log out everywhere" user action is deferred.

**Concurrent sessions.**
- Multiple concurrent logins for the same account on different browsers / devices are allowed. There is no exclusivity check.
- All sessions share the same conversation list, history, and last-seen cursors (§4).

## Non-functional requirements

Concrete targets for v1. Modest by design — the goal is a credible MVP, not a planet-scale product. Numbers below are starting points; revisit as we learn from real load.

### Latency
- **Human peer delivery:** message send → recipient socket receives, **p50 < 200 ms, p95 < 500 ms** (same-region peer; excludes the recipient's client render time).
- **Bot reply:** time to first streamed token **p95 < 2 s**; server-side overhead added on top of model latency **< 200 ms**; total bot response capped at **60 s** (request cancelled past that).
- **Initial page load:** time-to-interactive **< 3 s** on a typical broadband connection.

### Availability
- **99.5% monthly uptime** for v1 (~3.5 hours of unplanned downtime per month). Honest for a small team without 24/7 on-call; raise to 99.9% as on-call coverage matures.
- Scheduled maintenance announced ≥ 24h in advance, capped at 30 min, attempted in low-traffic hours.

### Scale ceiling (v1 design target)
- **10,000 registered accounts.**
- **1,000 concurrent WebSocket connections** at peak.
- **~100 messages/sec sustained**, bursts to ~300/sec absorbed.
- **Message storage, year 1: roughly 10–60 GB** of raw log. Rough math:
  - *Light usage* — avg 10 messages/user/day: 10,000 × 10 × 365 ≈ 36 M messages × ~300 B/row ≈ **~11 GB**.
  - *Active mixed usage* — avg 30 messages/user/day, bot replies skew row size up: 10,000 × 30 × 365 ≈ 110 M messages × ~500 B/row ≈ **~55 GB**.
  - Backups + replication multiply provisioned capacity ~2–5× on top. Sanity figure, not a hard limit; design for ~100 GB headroom in year 1.
- The architecture should not preclude horizontal scaling beyond these numbers — this sizes v1 hardware and load tests, it is not a permanent ceiling.

### Bot cost containment
ChatApp is a free product (see Architecture & hosting decisions), so bot quotas function as **hard cost ceilings** rather than soft preferences — exceeding them rejects the request rather than degrading quality.
- Per-user, per-day token budget: **target 20,000 tokens (input + output combined)** across all bot conversations. Exceeding the budget returns a user-facing rate-limit error until the next calendar day (UTC).
- Per-request output cap: **2,000 tokens**.
- Tracked server-side per `(user, bot, calendar day)`. Concrete numbers are placeholders to tune against real usage and provider pricing.

### Browser support matrix
- **Desktop:** Chrome, Edge, Firefox, Safari — latest two stable versions of each.
- **Mobile:** Safari (iOS) and Chrome (Android) — latest two stable versions.
- **Web Push on iOS Safari:** per Apple, requires the site to be installed to the home screen as a PWA. v1 supports the PWA path; users who do not install fall back to in-tab notifications only.
- No support for Internet Explorer or other legacy browsers.

### Accessibility
- Target **WCAG 2.1 AA** for the messaging UI: full keyboard navigation across conversation list, composer, and history; screen-reader-friendly semantics (proper roles for the message list, live region for incoming messages); minimum color contrast; focus management on conversation switch.
- Built in from the start — retroactive accessibility work is significantly more expensive than greenfield.

### Internationalization
- v1 ships **English only**.
- Content is UTF-8 end-to-end (database, transport, rendering); usernames, messages, and bot system prompts are all Unicode.
- i18n framework hooks (translation function, locale switcher scaffolding) in place so additional languages can be added without a refactor.

### Performance budgets
- Initial JS bundle: **≤ 300 KB gzipped** for the app shell; additional routes lazy-loaded.
- Conversation history uses **virtualized list rendering** so long messages (near the 20k character cap) or long histories do not freeze the UI thread.

### Operational
- **Daily database backups** with a **7-day point-in-time recovery** target.
- Monitoring & alerts on: active WebSocket count, message-send error rate, bot-provider error rate, push dispatcher backlog, p95 send latency.
- Runbooks for: server restart, push-subscription sweeper, bot-provider outage (degrade bot conversations gracefully while human chats continue).

## Infrastructure & architecture

### Decisions
- **Hosting.** All components live on **Fly.io** (existing account):
  - **Application server** — WebSocket fan-out, push dispatcher, bot orchestration — runs as a Fly app.
  - **Relational store (SQL)** — accounts, sessions, conversation metadata, and v1 message log — runs on **Fly Postgres**.
  - **Non-SQL store (future)** — if and when the Storage tech split (see TODO below) is taken, the key-value / wide-column message store also lives on Fly, self-hosted on Fly volumes or via a Fly-integrated managed option. v1 does not need this; everything fits in Fly Postgres.
  - The principle: own the hot path, rent the database — but keep both on the same platform so they share latency, networking, and operational tooling.
- **Bot providers.** Code supports **both OpenAI and Claude**; the active provider per bot is set via **server-side configuration** and is not exposed to users. **Shared server-side API keys** for the chosen provider, gated by the per-user daily token quota in §non-functional. The product is free, so that quota functions as a hard cost ceiling, not a soft preference. No user-supplied keys.
- **Transactional email.** **Resend** for verification, password reset, and future notification emails. Generous free tier covering v1 volume, clean API, simple deliverability story. Swap to Postmark if deliverability problems emerge at scale.
- **Primary region.** Fly **iad** (Ashburn, US-East) for v1. Single region keeps cross-region complexity out of the v1 architecture; multi-region is a Phase 5 concern (per-region data residency).
- **Frontend framework.** **React + Vite** for the web client. Chosen for the breadth of chat-UI libraries (virtualized lists, composer widgets) and ecosystem maturity. **Svelte/SvelteKit** is a defensible alternative — smaller bundles aligned with the 300 KB budget, simpler reactive model — and worth revisiting if bundle size becomes a blocker.

### TODO
Items to flesh out during design — listed here so they aren't forgotten:

- **Online presence service.** Who is currently online, last-seen timestamps. For v1 this can likely be derived from active WebSocket connections; at scale it typically grows into a dedicated subsystem (e.g., Redis-backed). Affects the "Delivered" indicator (§3) and any presence dots in the conversation list UI.
- **Message fan-out / queue.** How the server delivers a message to all of a recipient's open sockets — particularly across multiple server instances behind a load balancer. Likely Redis pub/sub or a dedicated broker. Also relevant for kicking off bot replies asynchronously so the user's send request isn't held open for the duration of the model call.
- **Bot-call orchestration.** How model API calls are issued (per-request worker, queue + worker pool), how cancellation works if the user closes the tab mid-stream, and how retries/timeouts are bounded.
- **Storage tech split — to evaluate.** Likely target shape at scale: **Fly Postgres** for accounts, sessions, conversation metadata, and any future relational data (friends, blocks, group membership); a **key-value / wide-column store** for the message log, which is append-heavy and queried as `(conversation_id, server_ts) → messages`. Per the hosting decision, any such store would also live on Fly — self-hosted on Fly volumes (e.g., ScyllaDB, FoundationDB) or a Fly-integrated managed offering. At MVP scale, a single Fly Postgres handles both cleanly with `(conversation_id, server_ts, message_id)` indexed; the split is a forward-looking decision to keep in mind so the persistence abstraction doesn't bake in assumptions that block it later.
- **Web Push subsystem (v1).** Required to satisfy §5 state D (notifications when the tab is closed). Pieces: a registered **service worker** on the client; **VAPID key pair** generated server-side and rotated as needed; **push subscription** persisted per `(user, browser)` on signup-to-notifications; a **push dispatcher** that, on incoming message, looks up the recipient's active WebSocket sessions and falls back to dispatching pushes to all of that recipient's stored subscriptions if none are active; subscription cleanup when a push endpoint returns a 410 Gone (browser unsubscribed).

## Post-MVP roadmap

Features deferred from v1, consolidated from the per-section "Deferred" lists. **Phase 1 is the targeted post-MVP scope** — basic features and quality bars the product needs beyond the bare minimum, and the realistic next milestone after v1 ships. **Phases 2–5 are stretch / future work** and intentionally speculative; sequencing within and across them can shift as real user demand becomes clear. Section references in `[§N]` brackets point back to where the item was originally described.

### Phase 1 — Planned post-MVP (basic features)
- Read receipts (off by default per user preference). [§3]
- Typing indicators. [§3]
- Edit and delete messages (delete-for-me and delete-for-everyone). [§3]
- "Mark as unread" gesture. [§5]
- Per-conversation mute. [§5]
- Username change after signup. [§1]
- Self-chat (a conversation with yourself, for notes). [§2]
- "Log out everywhere" as a discrete user action. [§1, §7]
- **CI load-testing harness.** Synthetic test that simulates N concurrent fake users opening WebSockets and exchanging messages, run as part of CI, verifying the system holds against the v1 scale and latency targets (~1,000 concurrent connections, ~100 msg/sec sustained, p95 delivery < 500 ms). Catches scale regressions before they reach production. [non-functional]

### Phase 2 — Trust, safety, and abuse mitigation
- Blocking and reporting. [§2]
- Message-request inbox (acceptance step before the first message is delivered). [§2]
- User-visible recent-activity view (auth events). [§6]
- User-visible list of active sessions with per-session revocation. [§7]
- "New login from a new browser" notification email. [§7]
- Anomaly detection (new IP / country / user-agent). [§7]
- Soft-delete with grace period before hard delete on account deletion. [§6]

### Phase 3 — Stronger auth & privacy controls
- Two-factor authentication. [§1, §6]
- Social login (Google, Apple). [§1]
- Logging in with email as an alternative to username. [§1]
- "Hide content" / sender-only toggle for push notification payloads. [§5, §6]
- Cross-device push dismissal (read on laptop → dismiss phone push). [§5]
- Per-message and per-conversation deletion. [§4]
- User-configurable retention windows (e.g., auto-delete after 30 days). [§4]

### Phase 4 — Bigger messaging features
- Media attachments (images, files, voice notes). [§3]
- Markdown / rich text. [§3]
- Link previews / OpenGraph cards. [§3]
- Full-text search across history. [§4]
- Long-term bot memory beyond the conversation history window. [§3]
- User-created bots with custom system prompts and model selection. [§2]
- Email digest of missed messages. [§5]
- Global quiet hours / Do Not Disturb. [§5]
- Username search / autocomplete in a directory. [§2]

### Phase 5 — Foundation expansion (re-architecture territory)
The items currently listed in the v1 non-goals section, restated as long-term work. Each implies architectural change rather than incremental feature work.
- Group conversations (3+ participants).
- Voice and video calls.
- Native iOS, Android, and desktop clients.
- True end-to-end encryption with device-bound keys and a key-transfer protocol.
- Per-region data residency. [§6]
- Federation / interoperability with other messaging networks.

### Operational follow-ons (not phased)
- Penetration testing program. [§6]
- Stricter age verification. [§6]
- Client-side cross-tab IPC (BroadcastChannel) for sub-roundtrip unread-badge sync. [§7]
- Persistent offline-compose queue that survives tab close. [§7]
