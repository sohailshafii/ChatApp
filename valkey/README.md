# Self-run Valkey (multi-machine scale-out)

A small, private [Valkey](https://valkey.io) (Redis-compatible) app on Fly that
backs the rate-limit counters, presence, WS pub/sub bus, and job leader lock when
running more than one app machine. See [`../docs/multi-machine.md`](../docs/multi-machine.md).

Flat-cost (one tiny always-on machine), no persistence (everything stored here is
ephemeral and self-heals), and **private** — no public IP; the app reaches it over
Fly's 6PN network at `<valkey-app>.internal:6379`.

> Like the main app, the `app` name in `fly.toml` is a placeholder. Pass
> `-a <your-valkey-app>` to target your real (globally-unique) app.

## One-time setup

Run from this `valkey/` directory.

```bash
# 1. Create the app (private — no IPs allocated until/unless you add a service).
fly apps create <your-valkey-app>

# 2. Set the password (generated; stored as a Fly secret, never in the image).
fly secrets set VALKEY_PASSWORD="$(openssl rand -hex 24)" -a <your-valkey-app>

# 3. Deploy it.
fly deploy -a <your-valkey-app>

# 4. Read the password back so you can build REDIS_URL (it's write-only via the CLI,
#    so capture it when you set it — re-run step 2 to rotate if you didn't).
```

Tip: capture the password when you generate it:

```bash
PW="$(openssl rand -hex 24)"
fly secrets set VALKEY_PASSWORD="$PW" -a <your-valkey-app>
echo "REDIS_URL=redis://default:$PW@<your-valkey-app>.internal:6379"
```

## Point the app at it

Set `REDIS_URL` on the **main app** (not this one) and redeploy it. The app stays
single-machine for now — this just switches the rate-limiter/presence/bus/leader
from in-process to the shared store:

```bash
fly secrets set \
  REDIS_URL="redis://default:<password>@<your-valkey-app>.internal:6379" \
  -a <your-app>
# redeploy the main app (from the repo root)
fly deploy -a <your-app>
```

Confirm in the main app's logs (`fly logs -a <your-app>`):

```
redis connected            (ok:true)
presence heartbeat started
ws bus subscribed
```

`redis connected` with `ok:true` means AUTH + the private DNS both work. If you see
`redis connect failed`, the app keeps running (Redis is non-fatal) — check the
password and that the Valkey app is started.

## Scale out (the actual N>1 flip)

Once the app is healthy on Redis at one machine, remove the `N = 1` guardrail and
scale. In the repo-root [`fly.toml`](../fly.toml) the single-machine note is just a
comment; the real switch is the machine count:

```bash
fly scale count 2 -a <your-app>
```

Watch that messages, bot streams, and push behave across machines (the two-instance
behavior we smoke-tested: a message sent on one machine reaches a socket on the
other; a deleted account's sockets close fleet-wide).

## Notes

- **No volume / no persistence.** We run with `--save "" --appendonly no`. A restart
  empties Valkey; the app self-heals (rate-limit windows reset, presence is
  re-established on the next heartbeat/reconnect, pub/sub is at-most-once by design).
- **Memory.** `--maxmemory 200mb` on a 256 MB VM with `allkeys-lru` eviction.
  Override with the `VALKEY_MAXMEMORY` secret if you resize the VM.
- **Rotate the password:** re-run the `fly secrets set VALKEY_PASSWORD=…` step, then
  update `REDIS_URL` on the main app. Both apps restart on a secret change.
- **One instance only.** No clustering; don't `fly scale count` this app above 1.
