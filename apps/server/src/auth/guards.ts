import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AccountUser } from '@chatapp/shared';
import { SESSION_COOKIE_NAME } from '@chatapp/shared';
import { touchSession } from './sessions.js';
import { sendError } from '../http/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Populated by the requireSession preHandler on authenticated routes.
    authUser?: AccountUser;
  }
}

// preHandler that requires a live session. On success it attaches the account to
// request.authUser and slides the session expiry (touchSession); otherwise it
// clears the stale cookie and replies 401 unauthorized, halting the route.
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = request.cookies[SESSION_COOKIE_NAME];
  const user = token ? await touchSession(token) : null;
  if (!user) {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return sendError(reply, 'unauthorized', 'Not authenticated');
  }
  request.authUser = user;
}
