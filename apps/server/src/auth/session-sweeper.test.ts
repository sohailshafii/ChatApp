import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { startSessionSweeper } from './session-sweeper.js';

// Minimal logger stub — the sweeper only calls info/error.
const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('startSessionSweeper', () => {
  it('sweeps once immediately and again each interval, until stopped', async () => {
    vi.useFakeTimers();
    const sweep = vi.fn().mockResolvedValue(0);

    const stop = startSessionSweeper(log, { intervalMs: 1000, sweep });

    // Immediate run (the `void run()` before the interval is set).
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sweep).toHaveBeenCalledTimes(3); // no further sweeps after stop
  });

  it('logs the count only when rows were deleted', async () => {
    vi.useFakeTimers();
    const sweep = vi.fn().mockResolvedValue(4);

    startSessionSweeper(log, { intervalMs: 1000, sweep });
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));

    expect(log.info).toHaveBeenCalledWith({ deleted: 4 }, 'swept expired sessions');
  });

  it('swallows a sweep failure and keeps running', async () => {
    vi.useFakeTimers();
    const sweep = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(0);

    const stop = startSessionSweeper(log, { intervalMs: 1000, sweep });
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledTimes(1));

    // Still scheduled after the error.
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(2);
    stop();
  });
});
