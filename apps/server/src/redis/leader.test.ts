import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shouldRunJob, tryAcquireLock } from './leader.js';

describe('shouldRunJob (no Redis)', () => {
  it('always runs at N=1 (REDIS_URL unset)', async () => {
    expect(await shouldRunJob('whatever', 1000)).toBe(true);
  });
});

// Real-Redis contention. Skipped unless TEST_REDIS_URL is set.
const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)('tryAcquireLock (Redis)', () => {
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

  it('grants the lock to exactly one of two contending machines', async () => {
    const a = await tryAcquireLock(client, 'job', 'machine-A', 60_000);
    const b = await tryAcquireLock(client, 'job', 'machine-B', 60_000);
    expect(a).toBe(true);
    expect(b).toBe(false); // A holds it
  });

  it('lets the holder renew, but not another machine', async () => {
    await tryAcquireLock(client, 'job', 'machine-A', 60_000);
    expect(await tryAcquireLock(client, 'job', 'machine-A', 60_000)).toBe(true); // renew
    expect(await tryAcquireLock(client, 'job', 'machine-B', 60_000)).toBe(false);
  });

  it('lets another machine take over once the lock expires', async () => {
    await tryAcquireLock(client, 'job', 'machine-A', 50); // tiny TTL
    await new Promise((r) => setTimeout(r, 80));
    expect(await tryAcquireLock(client, 'job', 'machine-B', 60_000)).toBe(true);
  });

  it('keeps separate jobs independent', async () => {
    expect(await tryAcquireLock(client, 'retention', 'machine-A', 60_000)).toBe(true);
    expect(await tryAcquireLock(client, 'export-worker', 'machine-B', 60_000)).toBe(true);
  });
});
