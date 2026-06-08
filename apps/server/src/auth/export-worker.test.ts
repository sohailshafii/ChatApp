import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { startExportWorker } from './export-worker.js';

const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('startExportWorker', () => {
  it('processes immediately and on each interval, until stopped', async () => {
    vi.useFakeTimers();
    const process = vi.fn().mockResolvedValue(0);
    const stop = startExportWorker(log, { intervalMs: 1000, process });

    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(process).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(process).toHaveBeenCalledTimes(2); // no runs after stop
  });

  it('logs a nonzero result and swallows a failing run', async () => {
    vi.useFakeTimers();
    const process = vi
      .fn()
      .mockResolvedValueOnce(2)
      .mockRejectedValue(new Error('db down'));
    const stop = startExportWorker(log, { intervalMs: 1000, process });

    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    expect(log.info).toHaveBeenCalledWith({ done: 2 }, 'processed export jobs');

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledTimes(1)); // still running
    stop();
  });
});
