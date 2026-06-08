import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePool } from './db/pool.js';
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
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host, port });
    // Start background jobs once we're listening: retention cleanup (§6/§7) and
    // the durable data-export worker (§6).
    background.push(startRetentionSweeper(app.log), startExportWorker(app.log));
  } catch (err) {
    app.log.error(err, 'failed to start server');
    process.exit(1);
  }
}

void main();
