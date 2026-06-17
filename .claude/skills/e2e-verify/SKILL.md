---
name: e2e-verify
description: Run ChatApp's end-to-end verification of the auth / account-deletion / data-export / Web Push API surface (§5, §6) against a live server + Postgres. Use when asked to verify these endpoints work end-to-end, confirm full-stack integration, or after server endpoint changes land.
---

# e2e-verify

Verifies the **account-deletion**, **data-export**, and **Web Push** endpoints
end-to-end by replaying the exact authenticated HTTP calls the web client makes
(`login` → CSRF → endpoint), against a live server + Postgres, and checking the
DB side effects.

## Run it

1. **Be on the latest `main`** (the endpoints must exist) and `npm install`
   (the server's `web-push` dep). The `main` branch is held by the
   `../ChatApp-server` worktree, so use detached `origin/main` in this clone:
   ```bash
   git fetch origin && git checkout --detach origin/main && npm install
   ```
2. **Docker daemon running** (the script brings Postgres up itself).
3. Run:
   ```bash
   bash scripts/e2e-verify.sh
   ```

The script: brings up Postgres + migrates, generates VAPID keys into `.env` if
absent, starts the dev server if one isn't already on `:8080` (and stops that
one on exit), runs the checks, and prints `==> Result: N passed, M failed`.
Exit 0 = all passed. **Postgres is left running** for the server agent.

**Invite-only safe (#90):** the script mints an invite for its throwaway email
before signup, so it passes whether or not `INVITE_ONLY` is enabled (it's the
prod posture and now the `.env` default). No manual override needed.

## What it checks
- mints an invite for the throwaway email (invite-only gate, #90)
- signup → verify (DB flip) → login (session cookie + CSRF issued)
- `GET /push/vapid-public-key` returns a key
- `POST /push/subscriptions` → 200, `DELETE /push/subscriptions` → 204
- `POST /auth/export` → 200 and creates a `data_exports` row
- `DELETE /auth/account` → 200, hard-deletes the account; `GET /auth/me` → 401

## Limits (do these manually / in staging)
- **API layer only** — does not drive a browser, so the UI clicks and the
  notification-permission dialog aren't exercised.
- **No real push delivery** — a closed-tab Web Push needs a real push service
  and a second offline recipient; the dispatcher is covered only at the
  subscribe round-trip here.
- If routes **404**, the working tree is stale (not on latest `main`) or
  `npm install` hasn't run.
