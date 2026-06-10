import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadConfig } from './config.js';
import { setAppLogger } from './log.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerConversationRoutes } from './routes/conversations.js';
import { registerBotRoutes } from './routes/bots.js';
import { registerPushRoutes } from './routes/push.js';
import { registerWebSocket } from './ws/server.js';

// Builds the Fastify instance with routes registered but without listening, so
// it can be reused by the entrypoint and (later) by tests.
export function buildApp(): FastifyInstance {
  const { logLevel } = loadConfig();

  const app = Fastify({
    logger: { level: logLevel },
    // Trust Fly's proxy so request IPs are correct for rate limiting later.
    trustProxy: true,
  });
  setAppLogger(app.log);

  // Cookie parsing/serialization for the session + CSRF cookies (§1, §6). No
  // secret: cookies are unsigned (the session token is itself unguessable, CSRF
  // is double-submit), so there is nothing to sign.
  app.register(fastifyCookie);

  // /healthz stays at the root for infra probes (Fly health checks). Everything
  // else lives under /api so the SPA and the API never share a path namespace
  // (#75): in production a static host can serve index.html for any non-/api,
  // non-/healthz path while the API answers /api/*. The WebSocket likewise moves
  // under /api (/api/ws, see ws/server.ts) so the contract is simply
  // "/api/* + /healthz are the server; everything else is the SPA".
  registerHealthRoutes(app);
  app.register(
    async (api) => {
      registerAuthRoutes(api);
      registerConversationRoutes(api);
      registerBotRoutes(api);
      registerPushRoutes(api);
    },
    { prefix: '/api' },
  );
  registerWebSocket(app);

  return app;
}
