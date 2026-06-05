import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import {
  getConversationParticipants,
  persistBotMessage,
} from '../conversations/messages.js';
import { broadcastToAccounts } from '../ws/send.js';
import {
  BotError,
  getBotProvider,
  type BotTurn,
  type BotUsage,
} from './provider.js';
import { systemPromptFor } from './registry.js';
import { isOverBudget, recordUsage } from './budget.js';
import {
  botInvocationKey,
  botLimiter,
  BOT_LIMITS,
} from '../rate-limit/bot-rate-limit.js';

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
  // Bot conversations have a single human participant; they own the token budget.
  const human = participants.accountIds[0];
  const messageId = randomUUID();

  broadcastToAccounts(targets, { type: 'bot_start', conversationId, messageId });

  // §3/§6: burst guard on bot invocations, per (user, bot). Checked before the
  // budget (in-memory, cheaper than the DB read) and before any model call. Like
  // budget_exceeded, the bot_start above lets the client correlate by messageId.
  if (
    human &&
    !botLimiter.check(botInvocationKey(human, botId), BOT_LIMITS.invoke)
  ) {
    broadcastToAccounts(targets, {
      type: 'bot_error',
      conversationId,
      messageId,
      code: 'rate_limited',
    });
    return;
  }

  // §cost: block once the user is over their per-day token budget. The bot_start
  // above means the client correlates this rejection by messageId like any other
  // bot_error. Nothing is sent to the model and no message is persisted.
  if (human && (await isOverBudget(human))) {
    broadcastToAccounts(targets, {
      type: 'bot_error',
      conversationId,
      messageId,
      code: 'budget_exceeded',
    });
    return;
  }

  let usage: BotUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    const history = await getConversationTurns(conversationId, botId);
    let content = '';
    const gen = getBotProvider().streamReply({
      systemPrompt: systemPromptFor(botId),
      history,
    });
    for (let r = await gen.next(); ; r = await gen.next()) {
      if (r.done) {
        usage = r.value;
        break;
      }
      content += r.value;
      broadcastToAccounts(targets, {
        type: 'bot_chunk',
        conversationId,
        messageId,
        delta: r.value,
      });
    }
    const message = await persistBotMessage(conversationId, botId, messageId, content);
    broadcastToAccounts(targets, { type: 'bot_end', message });
  } catch (err) {
    const code = err instanceof BotError ? err.code : 'internal_error';
    broadcastToAccounts(targets, {
      type: 'bot_error',
      conversationId,
      messageId,
      code,
    });
    return;
  }

  // Charge the reply's tokens after a successful delivery. Best-effort: an
  // accounting failure must not turn a delivered reply into a bot_error.
  if (human) {
    try {
      await recordUsage(human, usage.inputTokens + usage.outputTokens);
    } catch {
      /* accounting is best-effort */
    }
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
