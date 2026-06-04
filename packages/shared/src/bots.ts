import { z } from 'zod';

// Wire types for §2 bot peers — the system-curated bot list a user can start a
// conversation with. Users cannot create custom bots in v1.
export const botSchema = z.object({
  // Stable slug; matches the bot id in ConversationPeer / a conversation's peer.
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type Bot = z.infer<typeof botSchema>;

// GET /bots
export const botListResponseSchema = z.object({
  bots: z.array(botSchema),
});
export type BotListResponse = z.infer<typeof botListResponseSchema>;
