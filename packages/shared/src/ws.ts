import { z } from 'zod';
import { errorCodeSchema } from './errors.js';
import { messageContentSchema, messageSchema } from './messages.js';

// §3 WebSocket protocol. The socket is authenticated on upgrade by the session
// cookie with an Origin check (§6); these envelopes are the per-frame protocol
// afterwards. Every frame is JSON with a discriminating `type`.

// ---------- Client -> Server ----------

// Send a message. `clientMessageId` is client-generated for idempotent retry and
// optimistic-UI dedupe (§3).
export const wsSendSchema = z.object({
  type: z.literal('send'),
  conversationId: z.string().uuid(),
  clientMessageId: z.string().min(1).max(200),
  content: messageContentSchema,
});
export type WsSend = z.infer<typeof wsSendSchema>;

export const clientWsMessageSchema = z.discriminatedUnion('type', [wsSendSchema]);
export type ClientWsMessage = z.infer<typeof clientWsMessageSchema>;

// ---------- Server -> Client ----------

// Ack of the sender's own message: persisted and assigned a server id +
// timestamp. The sender moves sending -> sent and dedupes via clientMessageId.
export const wsAckSchema = z.object({
  type: z.literal('ack'),
  clientMessageId: z.string(),
  message: messageSchema,
});

// A new message in a conversation (from a peer, or this user's other tabs).
export const wsMessageSchema = z.object({
  type: z.literal('message'),
  message: messageSchema,
});

// Delivery receipt: at least one of the recipient's sockets received it (§3).
export const wsDeliveredSchema = z.object({
  type: z.literal('delivered'),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

// Bot reply streaming (§3): bot_start -> bot_chunk* -> bot_end, or bot_error.
// `messageId` is assigned up front so chunks correlate to the eventual message.
export const wsBotStartSchema = z.object({
  type: z.literal('bot_start'),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});
export const wsBotChunkSchema = z.object({
  type: z.literal('bot_chunk'),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  delta: z.string(),
});
export const wsBotEndSchema = z.object({
  type: z.literal('bot_end'),
  message: messageSchema,
});
export const wsBotErrorSchema = z.object({
  type: z.literal('bot_error'),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

// A protocol/validation error, correlated to a send via clientMessageId when
// applicable (e.g. validation_error, rate_limited).
export const wsErrorSchema = z.object({
  type: z.literal('error'),
  code: errorCodeSchema,
  message: z.string(),
  clientMessageId: z.string().nullable(),
});

export const serverWsMessageSchema = z.discriminatedUnion('type', [
  wsAckSchema,
  wsMessageSchema,
  wsDeliveredSchema,
  wsBotStartSchema,
  wsBotChunkSchema,
  wsBotEndSchema,
  wsBotErrorSchema,
  wsErrorSchema,
]);
export type ServerWsMessage = z.infer<typeof serverWsMessageSchema>;
