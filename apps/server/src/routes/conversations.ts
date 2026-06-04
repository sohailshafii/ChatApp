import type { FastifyInstance } from 'fastify';
import type { ConversationListResponse } from '@chatapp/shared';
import { requireSession } from '../auth/guards.js';
import { listConversations } from '../conversations/list.js';

export function registerConversationRoutes(app: FastifyInstance): void {
  // GET /conversations (§2) — the authenticated user's conversation list,
  // most-recent activity first.
  app.get(
    '/conversations',
    { preHandler: requireSession },
    async (request, reply) => {
      const body: ConversationListResponse = {
        conversations: await listConversations(request.authUser!.id),
      };
      return reply.code(200).send(body);
    },
  );
}
