import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import {
  getConversationParticipants,
  persistBotMessage,
} from '../conversations/messages.js';
import { broadcastToAccounts } from '../ws/send.js';
import { getBotProvider, type BotTurn } from './provider.js';
import { systemPromptFor } from './registry.js';

// Streams a bot reply for a send into a bot conversation (§3): bot_start ->
// bot_chunk* -> bot_end, or bot_error. The message id is assigned up front so the
// client can correlate the stream. The user's message is already persisted +
// acked by the WS send handler before this runs (persist-before-bot, per
// CLAUDE.md). Fire-and-forget: the caller does not await this.
export async function streamBotReply(
  conversationId: string,
  botId: string,
): Promise<void> {
  const participants = await getConversationParticipants(conversationId);
  if (!participants) return;
  const targets = participants.accountIds;
  const messageId = randomUUID();

  broadcastToAccounts(targets, { type: 'bot_start', conversationId, messageId });
  try {
    const history = await getConversationTurns(conversationId, botId);
    let content = '';
    for await (const delta of getBotProvider().streamReply({
      systemPrompt: systemPromptFor(botId),
      history,
    })) {
      content += delta;
      broadcastToAccounts(targets, {
        type: 'bot_chunk',
        conversationId,
        messageId,
        delta,
      });
    }
    const message = await persistBotMessage(conversationId, botId, messageId, content);
    broadcastToAccounts(targets, { type: 'bot_end', message });
  } catch {
    broadcastToAccounts(targets, { type: 'bot_error', conversationId, messageId });
  }
}

// The conversation so far as model turns: the bot's own messages are 'assistant',
// everyone else's are 'user'. Newest-capped, oldest-first.
async function getConversationTurns(
  conversationId: string,
  botId: string,
  limit = 20,
): Promise<BotTurn[]> {
  const { rows } = await query<{ sender_id: string; content: string }>(
    `SELECT sender_id, content FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [conversationId, limit],
  );
  return rows
    .reverse()
    .map((r) => ({
      role: r.sender_id === botId ? 'assistant' : 'user',
      content: r.content,
    }));
}
