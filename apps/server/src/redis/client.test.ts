import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeRedis,
  connectRedis,
  getRedis,
  redisPing,
  setRedisForTests,
} from './client.js';

// These exercise the phase-1 plumbing without a real Redis: the disabled path
// (REDIS_URL is unset in the test env → the in-process fallback) and the
// injection seam. Real-Redis tests against a container land with the
// Redis-backed limiters (phase 2). See docs/multi-machine.md.

// A no-op logger standing in for app.log.
const log = {
  info: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

// Minimal fake client recording the calls connectRedis/redisPing make.
function fakeRedis(overrides: Partial<Redis> = {}): Redis {
  return {
    on: vi.fn().mockReturnThis(),
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
    ...overrides,
  } as unknown as Redis;
}

afterEach(() => {
  setRedisForTests(undefined);
  vi.clearAllMocks();
});

describe('redis client (REDIS_URL unset)', () => {
  it('getRedis returns null when disabled', () => {
    expect(getRedis()).toBeNull();
  });

  it('connectRedis logs disabled and returns false', async () => {
    await expect(connectRedis(log)).resolves.toBe(false);
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('redis disabled'),
    );
  });

  it('redisPing returns false when disabled', async () => {
    await expect(redisPing()).resolves.toBe(false);
  });

  it('closeRedis is a no-op when disabled', async () => {
    await expect(closeRedis()).resolves.toBeUndefined();
  });
});

describe('redis client (injected)', () => {
  it('getRedis returns the injected client', () => {
    const r = fakeRedis();
    setRedisForTests(r);
    expect(getRedis()).toBe(r);
  });

  it('connectRedis connects, pings, and returns true on PONG', async () => {
    const r = fakeRedis();
    setRedisForTests(r);
    await expect(connectRedis(log)).resolves.toBe(true);
    expect(r.connect).toHaveBeenCalledOnce();
    expect(r.ping).toHaveBeenCalledOnce();
    // An error handler must be attached or ioredis error events crash the process.
    expect(r.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('connectRedis returns false (non-fatal) when connect throws', async () => {
    const r = fakeRedis({ connect: vi.fn().mockRejectedValue(new Error('boom')) });
    setRedisForTests(r);
    await expect(connectRedis(log)).resolves.toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it('redisPing returns true when the client answers PONG', async () => {
    setRedisForTests(fakeRedis());
    await expect(redisPing()).resolves.toBe(true);
  });

  it('redisPing returns false when the ping throws', async () => {
    setRedisForTests(fakeRedis({ ping: vi.fn().mockRejectedValue(new Error('down')) }));
    await expect(redisPing()).resolves.toBe(false);
  });
});
