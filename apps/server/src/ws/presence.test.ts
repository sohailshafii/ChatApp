import { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hub } from './hub.js';
import { LocalPresence, RedisPresence } from './presence.js';

// A live socket is just an object identity to the hub.
const sock = (): WebSocket => ({}) as unknown as WebSocket;

describe('LocalPresence (in-memory, N=1)', () => {
  afterEach(() => {
    // Drop anything the test left in the hub.
    for (const id of [...hub.accountIds()]) {
      for (const s of [...hub.socketsForAccount(id)]) hub.remove(id, s);
    }
  });

  it('reports online iff the local hub has a socket', async () => {
    const p = new LocalPresence();
    expect(await p.online('u1')).toBe(false);
    const s = sock();
    hub.add('u1', s);
    expect(await p.online('u1')).toBe(true);
    hub.remove('u1', s);
    expect(await p.online('u1')).toBe(false);
  });

  it('refresh/clear are no-ops', async () => {
    const p = new LocalPresence();
    await expect(p.refresh('u1')).resolves.toBeUndefined();
    await expect(p.clear('u1')).resolves.toBeUndefined();
  });
});

// Real-Redis coverage (the ZSET + Lua). Skipped unless TEST_REDIS_URL is set, so
// CI stays Redis-free; run with a throwaway Redis like the rate-limit backend test.
const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)('RedisPresence', () => {
  let client: Redis;
  beforeAll(() => {
    client = new Redis(url!);
  });
  afterEach(async () => {
    await client.flushdb();
  });
  afterAll(async () => {
    await client.quit();
  });

  it('sees presence set by ANOTHER machine (no local socket here)', async () => {
    const here = new RedisPresence(() => client, 'machine-A');
    const there = new RedisPresence(() => client, 'machine-B');
    expect(await here.online('u1')).toBe(false);
    await there.refresh('u1'); // u1 connects on machine B
    expect(await here.online('u1')).toBe(true); // machine A sees it via Redis
    await there.clear('u1'); // u1 disconnects on machine B
    expect(await here.online('u1')).toBe(false);
  });

  it('expires a member once its TTL passes (crash safety)', async () => {
    const p = new RedisPresence(() => client, 'machine-A');
    await p.refresh('u1');
    // Simulate a stale entry: rewrite the member with an already-past expiry score.
    await client.zadd('presence:u1', Date.now() - 1, 'machine-A');
    expect(await p.online('u1')).toBe(false); // pruned by ZREMRANGEBYSCORE
  });

  it('the local hub short-circuits online() without Redis', async () => {
    // No client at all → would be false, but a local socket forces true.
    const p = new RedisPresence(() => null, 'machine-A');
    expect(await p.online('u2')).toBe(false);
    const s = sock();
    hub.add('u2', s);
    expect(await p.online('u2')).toBe(true);
    hub.remove('u2', s);
  });
});
