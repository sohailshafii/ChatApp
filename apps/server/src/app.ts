import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';

// Builds the Fastify instance with routes registered but without listening, so
// it can be reused by the entrypoint and (later) by tests.
export function buildApp(): FastifyInstance {
  const { logLevel } = loadConfig();

  const app = Fastify({
    logger: { level: logLevel },
    // Trust Fly's proxy so request IPs are correct for rate limiting later.
    trustProxy: true,
  });

  registerHealthRoutes(app);
  registerAuthRoutes(app);

  return app;
}
