import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerConversationRoutes } from './routes/conversations.js';

// Builds the Fastify instance with routes registered but without listening, so
// it can be reused by the entrypoint and (later) by tests.
export function buildApp(): FastifyInstance {
  const { logLevel } = loadConfig();

  const app = Fastify({
    logger: { level: logLevel },
    // Trust Fly's proxy so request IPs are correct for rate limiting later.
    trustProxy: true,
  });

  // Cookie parsing/serialization for the session + CSRF cookies (§1, §6). No
  // secret: cookies are unsigned (the session token is itself unguessable, CSRF
  // is double-submit), so there is nothing to sign.
  app.register(fastifyCookie);

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerConversationRoutes(app);

  return app;
}
