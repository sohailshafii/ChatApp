#!/bin/sh
# Entrypoint for the self-run Valkey app. Reads the password from a Fly secret
# (VALKEY_PASSWORD) so it never lives in an image or fly.toml.
set -e

if [ -z "$VALKEY_PASSWORD" ]; then
  echo "VALKEY_PASSWORD is not set — refusing to start an unauthenticated Valkey" >&2
  exit 1
fi

# --bind "0.0.0.0 ::"  : listen on IPv4 and IPv6 (Fly's private 6PN is IPv6, so the
#                        app reaches us at <app>.internal over IPv6).
# --protected-mode no  : we rely on the private 6PN network + requirepass, not
#                        protected mode; this app has no public IP.
# --maxmemory + LRU    : cap memory under the VM size and evict, never OOM.
# --save "" / appendonly no : no persistence — everything we store (rate-limit
#                        counters, presence, pub/sub) is ephemeral and safe to lose
#                        on restart, so we skip the volume entirely.
exec valkey-server \
  --bind "0.0.0.0 ::" \
  --protected-mode no \
  --requirepass "$VALKEY_PASSWORD" \
  --maxmemory "${VALKEY_MAXMEMORY:-200mb}" \
  --maxmemory-policy allkeys-lru \
  --save "" \
  --appendonly no
