import { z } from 'zod';
import { emailSchema, isoDateSchema, usernameSchema } from './validation.js';

// What the authenticated user sees about themselves.
export const accountUserSchema = z.object({
  id: z.string().uuid(),
  username: usernameSchema,
  email: emailSchema,
  verified: z.boolean(),
  createdAt: isoDateSchema,
});

export type AccountUser = z.infer<typeof accountUserSchema>;

// What other users see about this user (e.g., a conversation peer).
export const publicUserSchema = z.object({
  id: z.string().uuid(),
  username: usernameSchema,
});

export type PublicUser = z.infer<typeof publicUserSchema>;
