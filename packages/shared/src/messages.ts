import { z } from 'zod';
import { isoDateSchema } from './validation.js';

// Wire types for §3 (Messaging) and §4 (History).

// Plain-text message body. Max 20,000 Unicode code points (§3, REQUIREMENTS),
// validated by code points — not UTF-16 units — on both client and server.
export const MESSAGE_CONTENT_MAX = 20_000;
export const messageContentSchema = z
  .string()
  .min(1, 'Message cannot be empty')
  .refine((s) => [...s].length <= MESSAGE_CONTENT_MAX, {
    message: 'Message is too long (max 20,000 characters)',
  });
export type MessageContent = z.infer<typeof messageContentSchema>;

// A persisted message. Ordering within a conversation is by the server-assigned
// `createdAt`; client clocks are never trusted for ordering (§3).
export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  // Author id: the sender's user id (uuid) or, for bot replies, the bot id.
  // Clients compare against their own AccountUser.id to render own vs peer.
  senderId: z.string().min(1),
  content: messageContentSchema,
  // Server-assigned timestamp; the ordering key within a conversation.
  createdAt: isoDateSchema,
  // Echoed back to the original sender so an optimistic message can be deduped
  // against the ack/broadcast (§3). Null for messages this client didn't send.
  clientMessageId: z.string().min(1).max(200).nullable(),
});
export type Message = z.infer<typeof messageSchema>;

// GET /conversations/:id/messages query (§4): cursor-based pagination backwards
// through history. `before` is an opaque cursor from a prior page's `nextBefore`.
export const messageHistoryQuerySchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type MessageHistoryQuery = z.infer<typeof messageHistoryQuerySchema>;

// A page of history, oldest-first within the page.
export const messagePageSchema = z.object({
  messages: z.array(messageSchema),
  // Opaque cursor for the next (older) page; null when the start of history is
  // reached.
  nextBefore: z.string().nullable(),
});
export type MessagePage = z.infer<typeof messagePageSchema>;

// POST /conversations/:id/read — advance the caller's last-seen cursor to clear
// unread (§7). Marks everything up to and including `messageId` as read.
export const markReadRequestSchema = z.object({
  messageId: z.string().uuid(),
});
export type MarkReadRequest = z.infer<typeof markReadRequestSchema>;
