import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePool } from './db/pool.js';
import { closeRedis, connectRedis } from './redis/client.js';
import { startPresenceHeartbeat } from './ws/presence.js';
import { startRetentionSweeper } from './auth/retention.js';
import { startExportWorker } from './auth/export-worker.js';

async function main(): Promise<void> {
  const { host, port } = loadConfig();
  const app = buildApp();

  const background: (() => void)[] = [];
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    for (const stop of background) stop();
    await app.close();
    await closeRedis();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host, port });
    // Connect the optional shared Redis (multi-machine scale-out); a no-op when
    // REDIS_URL is unset, non-fatal when it can't connect. See redis/client.ts.
    await connectRedis(app.log);
    // Start background jobs once we're listening: retention cleanup (§6/§7), the
    // durable data-export worker (§6), and the cross-machine presence heartbeat
    // (no-op without REDIS_URL).
    background.push(
      startRetentionSweeper(app.log),
      startExportWorker(app.log),
      startPresenceHeartbeat(app.log),
    );
  } catch (err) {
    app.log.error(err, 'failed to start server');
    process.exit(1);
  }
}

void main();
