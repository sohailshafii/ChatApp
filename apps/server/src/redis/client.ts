import { Redis, type RedisOptions } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { loadConfig } from '../config.js';

// Shared Redis/Valkey client for the multi-machine scale-out (docs/multi-machine.md).
//
// This is the phase-1 plumbing only: an optional client behind a factory, plus a
// boot-time connectivity check and graceful shutdown. Nothing reads or writes
// Redis yet — the rate-limit counters (phase 2) and WS pub/sub + presence
// (phases 3–4) get wired to it later. So with REDIS_URL set today the process
// merely connects and pings; behavior is unchanged.
//
// REDIS_URL is optional. When unset, getRedis() returns null and callers fall
// back to their in-process implementations — the same "optional infra" pattern
// as the mail sender (RESEND_API_KEY), bot providers (API keys), and Web Push
// (VAPID keys). So the single-machine default (N=1) needs no Redis, and the test
// suite runs Redis-free.

// undefined = not yet constructed; null = constructed and intentionally absent
// (REDIS_URL unset). Caching null avoids re-reading config on every call.
let client: Redis | null | undefined;

// Test seam: inject a client (e.g. ioredis-mock) or force-disable with null.
let override: Redis | null | undefined;
export function setRedisForTests(c: Redis | null | undefined): void {
  override = c;
}

function buildOptions(): RedisOptions {
  return {
    // Construct without dialing; connectRedis() (or the first command) connects.
    // Keeps DB/Redis-free endpoints (e.g. GET /healthz) working when Redis is
    // unreachable, mirroring the lazy pg pool.
    lazyConnect: true,
    // Don't fail fast on commands while a reconnect is in flight; ioredis queues
    // and retries. Sensible for the fan-out/counter workloads landing later.
    maxRetriesPerRequest: null,
  };
}

// The shared client, or null when REDIS_URL is unset (→ in-process fallback).
export function getRedis(): Redis | null {
  if (override !== undefined) return override;
  if (client === undefined) {
    const { redisUrl } = loadConfig();
    client = redisUrl ? new Redis(redisUrl, buildOptions()) : null;
  }
  return client;
}

// Connect at boot and verify with a PING. Non-fatal: a missing or unreachable
// Redis only logs (phase 1 doesn't depend on it), and ioredis keeps retrying in
// the background. Returns whether the ping succeeded.
export async function connectRedis(log: FastifyBaseLogger): Promise<boolean> {
  const r = getRedis();
  if (!r) {
    log.info('redis disabled (REDIS_URL unset); using in-process fallbacks');
    return false;
  }
  // Without a handler, ioredis "error" events would crash the process.
  r.on('error', (err: Error) => log.error({ err }, 'redis error'));
  try {
    await r.connect();
    const ok = (await r.ping()) === 'PONG';
    log.info({ ok }, 'redis connected');
    return ok;
  } catch (err) {
    log.error({ err }, 'redis connect failed (continuing without it)');
    return false;
  }
}

// Liveness check for Redis: true only when a PING round-trips. False when
// disabled or unreachable.
export async function redisPing(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    return (await r.ping()) === 'PONG';
  } catch {
    return false;
  }
}

// Graceful shutdown. quit() drains pending commands; fall back to a hard
// disconnect if that fails.
export async function closeRedis(): Promise<void> {
  if (!client) return;
  const c = client;
  client = undefined;
  try {
    await c.quit();
  } catch {
    c.disconnect();
  }
}
