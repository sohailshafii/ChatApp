import type { FastifyReply } from 'fastify';
import type { ErrorCode, ErrorEnvelope } from '@chatapp/shared';

// Maps the shared machine-readable error codes (§ errors.ts) to HTTP statuses.
// All non-2xx responses use the shared { error: { code, message } } envelope.
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_error: 400,
  invalid_credentials: 401,
  unauthorized: 401,
  unverified: 403,
  csrf_failure: 403,
  not_found: 404,
  username_taken: 409,
  email_taken: 409,
  invite_required: 403,
  invalid_token: 400,
  expired_token: 410,
  rate_limited: 429,
  internal_error: 500,
};

export function sendError(
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
): FastifyReply {
  const envelope: ErrorEnvelope = { error: { code, message } };
  return reply.code(STATUS_BY_CODE[code]).send(envelope);
}
