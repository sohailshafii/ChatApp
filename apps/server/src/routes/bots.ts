import type { FastifyInstance } from 'fastify';
import type { BotListResponse } from '@chatapp/shared';
import { requireSession } from '../auth/guards.js';
import { listBots } from '../bots/registry.js';

export function registerBotRoutes(app: FastifyInstance): void {
  // GET /bots (§2) — the system-curated bot list a user can start a chat with.
  app.get('/bots', { preHandler: requireSession }, async (_request, reply) => {
    const body: BotListResponse = { bots: [...listBots()] };
    return reply.send(body);
  });
}
