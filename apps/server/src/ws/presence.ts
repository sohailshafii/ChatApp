import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { loadConfig } from '../config.js';
import { appLog } from '../log.js';
import { getRedis } from '../redis/client.js';
import { hub } from './hub.js';

// Cross-machine presence (multi-machine scale-out, Half B — docs/multi-machine.md):
// "does this account have a live WS socket on ANY machine?". The local `hub` only
// knows this process's sockets; presence aggregates across the fleet so the push
// dispatcher doesn't spuriously notify a user who's connected elsewhere.
//
// Backend picked by REDIS_URL (like the rate limiters): in-memory (N=1, the local
// hub IS the fleet) or Redis. Both are awaited by the dispatcher.

// Stable id for this process. Fly injects FLY_MACHINE_ID; fall back to a random id
// for local/dev so two in-process instances in a test can still differ.
export const MACHINE_ID = process.env.FLY_MACHINE_ID ?? randomUUID();

// TTL must exceed the heartbeat with margin: a single missed beat shouldn't drop a
// live user, but a crashed machine's presence clears within the TTL.
export const PRESENCE_TTL_MS = 60_000;
export const PRESENCE_HEARTBEAT_MS = 25_000;

export interface Presence {
  // Mark/refresh this machine as holding a live socket for the account.
  refresh(accountId: string): Promise<void>;
  // This machine no longer has any socket for the account.
  clear(accountId: string): Promise<void>;
  // Does ANY machine (including this one) have a live socket for the account?
  online(accountId: string): Promise<boolean>;
}

// In-memory backend (N=1): the local hub is the whole fleet.
export class LocalPresence implements Presence {
  async refresh(_accountId: string): Promise<void> {}
  async clear(_accountId: string): Promise<void> {}
  async online(accountId: string): Promise<boolean> {
    return hub.socketsForAccount(accountId).size > 0;
  }
}

// Prune expired members, then report whether any remain. A ZSET (member =
// machineId, score = expiry ms) lets the existence check be O(log n) instead of
// the SCAN a key-per-machine scheme would force.
const ONLINE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
return redis.call('ZCARD', KEYS[1])`;

export class RedisPresence implements Presence {
  constructor(
    private readonly redis: () => Redis | null = getRedis,
    private readonly machineId: string = MACHINE_ID,
  ) {}

  private key(accountId: string): string {
    return `presence:${accountId}`;
  }

  async refresh(accountId: string): Promise<void> {
    const r = this.redis();
    if (!r) return;
    try {
      const key = this.key(accountId);
      await r.zadd(key, Date.now() + PRESENCE_TTL_MS, this.machineId);
      // Safety net so a fully-departed account's ZSET can't linger forever.
      await r.pexpire(key, PRESENCE_TTL_MS * 2);
    } catch (err) {
      appLog().error({ err, accountId }, 'presence refresh failed');
    }
  }

  async clear(accountId: string): Promise<void> {
    const r = this.redis();
    if (!r) return;
    try {
      await r.zrem(this.key(accountId), this.machineId);
    } catch (err) {
      appLog().error({ err, accountId }, 'presence clear failed');
    }
  }

  async online(accountId: string): Promise<boolean> {
    // Fast path: our own sockets need no round trip, and are authoritative for this
    // machine even if a presence write briefly lagged.
    if (hub.socketsForAccount(accountId).size > 0) return true;
    const r = this.redis();
    if (!r) return false;
    try {
      const card = (await r.eval(
        ONLINE,
        1,
        this.key(accountId),
        String(Date.now()),
      )) as number;
      return card > 0;
    } catch (err) {
      // Fail "online" so a Redis blip doesn't turn into a burst of spurious pushes
      // to users who are in fact connected — that's the bug presence exists to fix.
      appLog().error({ err, accountId }, 'presence online check failed; assuming online');
      return true;
    }
  }
}

export function createPresence(): Presence {
  return loadConfig().redisConfigured ? new RedisPresence() : new LocalPresence();
}

// Process-wide instance, like the rate limiters.
export const presence = createPresence();

// Refresh presence for every account this machine currently holds sockets for, so
// keys don't expire mid-session. No-op (and no timer) on the in-memory backend.
// Started from index.ts; unref'd so it can't keep the process alive.
export function startPresenceHeartbeat(log: FastifyBaseLogger): () => void {
  if (!loadConfig().redisConfigured) return () => {};
  const tick = (): void => {
    for (const accountId of hub.accountIds()) void presence.refresh(accountId);
  };
  const timer = setInterval(tick, PRESENCE_HEARTBEAT_MS);
  timer.unref();
  log.info('presence heartbeat started');
  return () => clearInterval(timer);
}
