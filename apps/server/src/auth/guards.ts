import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AccountUser } from '@chatapp/shared';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from '@chatapp/shared';
import { touchSession } from './sessions.js';
import { csrfTokensMatch } from './csrf.js';
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

// preHandler enforcing the double-submit CSRF token on state-changing routes
// (§6): the csrf_token cookie must match the X-CSRF-Token header. Pair after
// requireSession, e.g. `preHandler: [requireSession, requireCsrf]`.
export async function requireCsrf(request: FastifyRequest, reply: FastifyReply) {
  const ok = csrfTokensMatch(
    request.cookies[CSRF_COOKIE_NAME],
    request.headers[CSRF_HEADER_NAME.toLowerCase()],
  );
  if (!ok) {
    return sendError(reply, 'csrf_failure', 'CSRF token missing or invalid');
  }
}
