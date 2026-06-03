import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePool } from './db/pool.js';

async function main(): Promise<void> {
  const { host, port } = loadConfig();
  const app = buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err, 'failed to start server');
    process.exit(1);
  }
}

void main();
