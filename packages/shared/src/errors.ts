import { z } from 'zod';

// All non-2xx responses use this envelope.
// `code` is machine-readable for client branching; `message` is user-displayable.

export const errorCodeSchema = z.enum([
  'validation_error',
  'invalid_credentials',
  'username_taken',
  'email_taken',
  'rate_limited',
  'not_found',
  'unverified',
  'invalid_token',
  'expired_token',
  'csrf_failure',
  'unauthorized',
  'internal_error',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
