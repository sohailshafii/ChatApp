import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  messageHistoryQuerySchema,
  markReadRequestSchema,
  startConversationRequestSchema,
  type ConversationListResponse,
  type ConversationResponse,
  type MessagePage,
  type StartConversationResponse,
} from '@chatapp/shared';
import { requireSession, requireCsrf } from '../auth/guards.js';
import {
  listConversations,
  getConversationSummary,
} from '../conversations/summaries.js';
import {
  getMessagePage,
  isParticipant,
  markRead,
} from '../conversations/messages.js';
import { startConversation, hideConversation } from '../conversations/manage.js';
import {
  usernameLookupLimiter,
  USERNAME_LOOKUP_LIMITS,
  usernameLookupAccountKey,
  usernameLookupIpKey,
} from '../rate-limit/username-lookup-rate-limit.js';
import { sendError } from '../http/errors.js';

const uuidSchema = z.string().uuid();

function paramId(request: { params: unknown }): string | null {
  const parsed = uuidSchema.safeParse((request.params as { id?: unknown }).id);
  return parsed.success ? parsed.data : null;
}

export function registerConversationRoutes(app: FastifyInstance): void {
  // GET /conversations (§2) — the caller's conversation list, newest first.
  app.get(
    '/conversations',
    { preHandler: requireSession },
    async (request, reply) => {
      const body: ConversationListResponse = {
        conversations: await listConversations(request.authUser!.id),
      };
      return reply.send(body);
    },
  );

  // POST /conversations (§2) — start, or fetch the existing, conversation with a
  // peer (idempotent). Human peers by exact username, bot peers by id; an
  // unaddressable peer (unknown/unverified user, self, unknown bot) returns a
  // generic not_found (no enumeration).
  app.post(
    '/conversations',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const parsed = startConversationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(
          reply,
          'validation_error',
          parsed.error.issues[0]?.message ?? 'Invalid request',
        );
      }
      // Rate-limit the username lookup (§6): a human peer is resolved by exact
      // username, so an unbounded caller could enumerate accounts. Check before
      // the DB hit, and only for human peers — bot ids resolve against the
      // in-process registry, not a lookup. Order: per-account first (consumes a
      // hit, then short-circuits without consuming the per-IP allowance on a
      // breach), matching the auth limiter.
      if (parsed.data.peerKind === 'human') {
        const accountId = request.authUser!.id;
        const overLimit =
          !usernameLookupLimiter.check(
            usernameLookupAccountKey(accountId),
            USERNAME_LOOKUP_LIMITS.perAccount,
          ) ||
          !usernameLookupLimiter.check(
            usernameLookupIpKey(request.ip),
            USERNAME_LOOKUP_LIMITS.perIp,
          );
        if (overLimit) {
          return sendError(
            reply,
            'rate_limited',
            'Too many lookups. Please wait a bit and try again.',
          );
        }
      }
      const conversationId = await startConversation(
        request.authUser!.id,
        parsed.data,
      );
      if (!conversationId) {
        return sendError(reply, 'not_found', 'No such user');
      }
      const conversation = await getConversationSummary(
        request.authUser!.id,
        conversationId,
      );
      const body: StartConversationResponse = { conversation: conversation! };
      return reply.send(body);
    },
  );

  // GET /conversations/:id (§2) — a single conversation summary. 404 (generic)
  // when the conversation doesn't exist or the caller isn't a participant.
  app.get(
    '/conversations/:id',
    { preHandler: requireSession },
    async (request, reply) => {
      const id = paramId(request);
      const conversation = id
        ? await getConversationSummary(request.authUser!.id, id)
        : null;
      if (!conversation) {
        return sendError(reply, 'not_found', 'Conversation not found');
      }
      const body: ConversationResponse = { conversation };
      return reply.send(body);
    },
  );

  // GET /conversations/:id/messages (§4) — backward-paginated history.
  app.get(
    '/conversations/:id/messages',
    { preHandler: requireSession },
    async (request, reply) => {
      const id = paramId(request);
      if (!id || !(await isParticipant(request.authUser!.id, id))) {
        return sendError(reply, 'not_found', 'Conversation not found');
      }
      const q = messageHistoryQuerySchema.safeParse(request.query);
      if (!q.success) {
        return sendError(
          reply,
          'validation_error',
          q.error.issues[0]?.message ?? 'Invalid query',
        );
      }
      // The `before` cursor is a message id.
      if (
        q.data.before !== undefined &&
        !uuidSchema.safeParse(q.data.before).success
      ) {
        return sendError(reply, 'validation_error', 'Invalid pagination cursor');
      }
      const body: MessagePage = await getMessagePage(
        id,
        q.data.before ?? null,
        q.data.limit,
      );
      return reply.send(body);
    },
  );

  // POST /conversations/:id/read (§7) — advance the last-seen cursor. State-
  // changing, so it requires the double-submit CSRF token.
  app.post(
    '/conversations/:id/read',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const id = paramId(request);
      if (!id) return sendError(reply, 'not_found', 'Conversation not found');
      const parsed = markReadRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(
          reply,
          'validation_error',
          parsed.error.issues[0]?.message ?? 'Invalid request',
        );
      }
      const ok = await markRead(
        request.authUser!.id,
        id,
        parsed.data.messageId,
      );
      if (!ok) {
        return sendError(reply, 'not_found', 'Conversation or message not found');
      }
      return reply.code(204).send();
    },
  );

  // DELETE /conversations/:id (§2) — hide the conversation from the caller's
  // list (the peer is unaffected). New activity un-hides it.
  app.delete(
    '/conversations/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const id = paramId(request);
      if (!id || !(await hideConversation(request.authUser!.id, id))) {
        return sendError(reply, 'not_found', 'Conversation not found');
      }
      return reply.code(204).send();
    },
  );
}
