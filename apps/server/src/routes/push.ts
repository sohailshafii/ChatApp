import type { FastifyInstance } from 'fastify';
import {
  pushSubscriptionSchema,
  deletePushSubscriptionSchema,
  type VapidPublicKeyResponse,
} from '@chatapp/shared';
import { requireSession, requireCsrf } from '../auth/guards.js';
import { sendError } from '../http/errors.js';
import { loadConfig } from '../config.js';
import { recordAuthEvent } from '../auth/audit.js';
import { upsertSubscription, deleteSubscription } from '../push/subscriptions.js';

// §5 Web Push endpoints. All require a session; the state-changing ones also
// require the double-submit CSRF token. Contracts live in @chatapp/shared/push.ts.
export function registerPushRoutes(app: FastifyInstance): void {
  // GET /push/vapid-public-key — the applicationServerKey the browser subscribes
  // with. Public key, so no CSRF; a session is still required. Errors when push
  // isn't configured (no VAPID keypair) — the web treats push as best-effort.
  app.get(
    '/push/vapid-public-key',
    { preHandler: requireSession },
    async (_request, reply) => {
      const { vapidPublicKey } = loadConfig();
      if (!vapidPublicKey) {
        return sendError(reply, 'internal_error', 'Push is not configured');
      }
      const body: VapidPublicKeyResponse = { publicKey: vapidPublicKey };
      return reply.send(body);
    },
  );

  // POST /push/subscriptions — register this browser/device for the authed user.
  // Idempotent on endpoint. 200 empty.
  app.post(
    '/push/subscriptions',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const parsed = pushSubscriptionSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(
          reply,
          'validation_error',
          parsed.error.issues[0]?.message ?? 'Invalid subscription',
        );
      }
      const accountId = request.authUser!.id;
      await upsertSubscription(accountId, parsed.data);
      await recordAuthEvent(request.log, 'push_subscription_added', {
        accountId,
        ip: request.ip,
      });
      return reply.code(200).send();
    },
  );

  // DELETE /push/subscriptions — remove a subscription (web calls on logout). 204.
  app.delete(
    '/push/subscriptions',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const parsed = deletePushSubscriptionSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(
          reply,
          'validation_error',
          parsed.error.issues[0]?.message ?? 'Invalid request',
        );
      }
      const accountId = request.authUser!.id;
      await deleteSubscription(accountId, parsed.data.endpoint);
      await recordAuthEvent(request.log, 'push_subscription_removed', {
        accountId,
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );
}
