import { z } from 'zod';
import { isoDateSchema, usernameSchema } from './validation.js';

// Wire types for §2 (Conversations & Peers) — the conversation list.
// The endpoint path is documented alongside each schema; the canonical path
// list lives in the server's route module.

// A conversation's peer is either another human (shown by username) or a
// system-curated bot (shown by name). `kind` discriminates the two.
export const conversationPeerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('human'),
    id: z.string().uuid(),
    username: usernameSchema,
  }),
  z.object({
    kind: z.literal('bot'),
    // Bots are server-configured; their id is a stable slug, not a uuid.
    id: z.string().min(1),
    name: z.string().min(1),
  }),
]);
export type ConversationPeer = z.infer<typeof conversationPeerSchema>;

// The last-message preview shown in a list row; null when the conversation has
// no messages yet.
export const messagePreviewSchema = z.object({
  preview: z.string(),
  at: isoDateSchema,
});
export type MessagePreview = z.infer<typeof messagePreviewSchema>;

// One entry in a user's conversation list (§2). The list is sorted by
// `updatedAt` descending (most recent activity first).
export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  peer: conversationPeerSchema,
  lastMessage: messagePreviewSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  updatedAt: isoDateSchema,
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

// GET /conversations — the authenticated user's conversation list.
export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
});
export type ConversationListResponse = z.infer<
  typeof conversationListResponseSchema
>;
