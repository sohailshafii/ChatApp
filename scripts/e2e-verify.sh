#!/usr/bin/env bash
# End-to-end verification of the auth / account / data-export / Web Push API
# surface (REQUIREMENTS.md §5, §6), replicating the exact authenticated HTTP
# calls the web client makes against a live server + Postgres.
#
#   Usage:  bash scripts/e2e-verify.sh
#   Exit:   0 = all checks passed, non-zero = a check failed or setup error.
#
# Brings up Postgres, applies migrations, generates VAPID keys into .env if
# absent, and starts the dev server if one isn't already on :8080 (stopping it
# again on exit). Postgres is left running. Mints an invite for its throwaway
# account so it passes whether or not INVITE_ONLY is enabled (#90).
#
# IMPORTANT: run from a working tree on the LATEST main (the endpoints must
# exist) and after `npm install` (the server's web-push dep). 404s almost always
# mean a stale tree or a missing install. See .claude/skills/e2e-verify.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# REST lives under /api (#75 — the SPA owns the root namespace, the API is /api/*).
BASE=http://localhost:8080/api
ORG=http://localhost:5173
PASS=0
FAIL=0
J="$(mktemp)"
SERVER_LOG="$(mktemp)"
STARTED_SERVER=""

cleanup() {
  [ -n "$STARTED_SERVER" ] && kill "$STARTED_SERVER" 2>/dev/null
  rm -f "$J" "$SERVER_LOG"
}
trap cleanup EXIT

ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
bad() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }
psql_q() { docker exec chatapp-postgres psql -U chatapp -d chatapp -tA -c "$1"; }
http_code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "==> Prerequisites"
docker info >/dev/null 2>&1 || { echo "Docker is not running. Start it and retry."; exit 2; }
if npm run db:up >/dev/null 2>&1; then ok "Postgres up"; else echo "Postgres failed to start"; exit 2; fi
if npm run migrate --workspace=@chatapp/server >/dev/null 2>&1; then ok "migrations applied"; else bad "migrate failed"; fi

if ! grep -qE '^VAPID_PUBLIC_KEY=.+' .env 2>/dev/null; then
  echo "==> Generating VAPID keys into .env"
  npx --yes web-push generate-vapid-keys --json 2>/dev/null | node -e '
    let d = ""; process.stdin.on("data", c => d += c).on("end", () => {
      const { publicKey, privateKey } = JSON.parse(d);
      const fs = require("fs");
      let e = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
      const set = (k, v) => {
        e = e.match(new RegExp("^" + k + "=", "m"))
          ? e.replace(new RegExp("^" + k + "=.*$", "m"), k + "=" + v)
          : e + "\n" + k + "=" + v;
      };
      set("VAPID_PUBLIC_KEY", publicKey);
      set("VAPID_PRIVATE_KEY", privateKey);
      fs.writeFileSync(".env", e);
    });' && ok "VAPID keys set" || bad "VAPID key generation failed"
fi

echo "==> Server"
if [ "$(http_code "$BASE/auth/me")" = "000" ]; then
  echo "  starting dev:server…"
  npm run dev:server >"$SERVER_LOG" 2>&1 &
  STARTED_SERVER=$!
  # Wait for readiness without sleep: retry on connection-refused.
  curl -s -o /dev/null --retry 60 --retry-connrefused --retry-delay 1 "$BASE/auth/me" 2>/dev/null
fi
if [ "$(http_code "$BASE/auth/me")" = "000" ]; then
  bad "server not reachable on :8080"
  echo "--- server log (tail) ---"; tail -15 "$SERVER_LOG"
  exit 2
fi
ok "server reachable"

echo "==> Flow (a throwaway account)"
TS="$(date +%s)"
UN="e2e_$TS"; EM="e2e_$TS@example.com"; PW="verifyPass123"
SUB_ENDPOINT="https://fcm.googleapis.com/fcm/send/e2e-$TS"

# Invite-only gate (#90): when INVITE_ONLY=true (the prod posture, and now the
# .env default) signup requires a pending invite for the exact email. Mint one
# for the throwaway address via the server's invite CLI so the flow passes
# regardless of the gate — an unused invite is harmless when it's off. Done
# against the DB, so it also works when reusing an already-running server.
if npm run invite --workspace=@chatapp/server -- "$EM" >/dev/null 2>&1; then
  ok "invite minted (invite-gate safe)"
else
  bad "invite mint failed (signup will 403 if INVITE_ONLY=true)"
fi

code=$(http_code -X POST "$BASE/auth/signup" -H "Content-Type:application/json" -H "Origin:$ORG" \
  -d "{\"username\":\"$UN\",\"email\":\"$EM\",\"password\":\"$PW\"}")
[ "$code" = "200" ] && ok "signup ($code)" || bad "signup ($code)"

psql_q "UPDATE accounts SET verified=true WHERE username='$UN';" >/dev/null \
  && ok "account verified (db)" || bad "could not mark account verified"

code=$(curl -s -c "$J" -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" \
  -H "Content-Type:application/json" -H "Origin:$ORG" \
  -d "{\"username\":\"$UN\",\"password\":\"$PW\"}")
CSRF=$(awk '/csrf_token/{print $7}' "$J")
{ [ "$code" = "200" ] && [ -n "$CSRF" ]; } && ok "login + session + CSRF ($code)" || bad "login ($code, csrf set: ${CSRF:+yes})"

echo "==> §5 Web Push"
if curl -s -b "$J" "$BASE/push/vapid-public-key" | grep -q '"publicKey"'; then
  ok "GET /push/vapid-public-key returns a key"
else
  bad "GET /push/vapid-public-key (no publicKey — VAPID configured?)"
fi

code=$(http_code -b "$J" -H "X-CSRF-Token:$CSRF" -H "Content-Type:application/json" -H "Origin:$ORG" \
  -X POST "$BASE/push/subscriptions" \
  -d "{\"endpoint\":\"$SUB_ENDPOINT\",\"expirationTime\":null,\"keys\":{\"p256dh\":\"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM\",\"auth\":\"tBHItJI5svbpez7KI4CCXg\"}}")
[ "$code" = "200" ] && ok "POST /push/subscriptions ($code)" || bad "POST /push/subscriptions ($code)"

code=$(http_code -b "$J" -H "X-CSRF-Token:$CSRF" -H "Content-Type:application/json" -H "Origin:$ORG" \
  -X DELETE "$BASE/push/subscriptions" -d "{\"endpoint\":\"$SUB_ENDPOINT\"}")
[ "$code" = "204" ] && ok "DELETE /push/subscriptions ($code)" || bad "DELETE /push/subscriptions ($code)"

echo "==> §6 Data export"
code=$(http_code -b "$J" -H "X-CSRF-Token:$CSRF" -H "Origin:$ORG" -X POST "$BASE/auth/export")
rows=$(psql_q "SELECT count(*) FROM data_exports e JOIN accounts a ON a.id=e.account_id WHERE a.username='$UN';")
{ [ "$code" = "200" ] && [ "$rows" = "1" ]; } && ok "POST /auth/export ($code, data_exports rows=$rows)" || bad "POST /auth/export ($code, rows=$rows)"

echo "==> §6 Account deletion (destructive)"
code=$(http_code -b "$J" -H "X-CSRF-Token:$CSRF" -H "Content-Type:application/json" -H "Origin:$ORG" \
  -X DELETE "$BASE/auth/account" -d "{\"password\":\"$PW\"}")
rows=$(psql_q "SELECT count(*) FROM accounts WHERE username='$UN';")
{ [ "$code" = "200" ] && [ "$rows" = "0" ]; } && ok "DELETE /auth/account ($code, account row gone)" || bad "DELETE /auth/account ($code, rows=$rows)"

code=$(http_code -b "$J" "$BASE/auth/me")
[ "$code" = "401" ] && ok "GET /auth/me after deletion ($code, session destroyed)" || bad "GET /auth/me after deletion ($code, expected 401)"

echo
echo "==> Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
