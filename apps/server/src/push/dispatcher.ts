import type { PushPayload } from '@chatapp/shared';
import { getBot } from '../bots/registry.js';
import { presence } from '../ws/presence.js';
import { query } from '../db/pool.js';
import { appLog } from '../log.js';
import { listSubscriptions, deleteByEndpoint } from './subscriptions.js';
import { getPushSender, isPushConfigured } from './sender.js';

// §5 push dispatcher. When a message reaches a recipient who has no live socket
// (closed tab / asleep), send a Web Push to each of their subscriptions so they
// still get notified. Unified for human and bot messages: `senderId` is a human
// account id (title = username) or a bot slug (title = bot name).
//
// Offline = no live socket for that account on ANY machine, via cross-machine
// presence (ws/presence.ts). With the in-memory backend (N=1) that's just the
// local hub; with Redis it spans the fleet, so a recipient connected to another
// machine is correctly seen as online and not spuriously pushed. Best-effort and
// fire-and-forget: never throws.

const PREVIEW_MAX = 100; // ~100-char notification body

type DispatchMessage = {
  conversationId: string;
  senderId: string;
  content: string;
};

export async function dispatchMessagePush(
  message: DispatchMessage,
  participantAccountIds: readonly string[],
): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const recipients: string[] = [];
    for (const id of participantAccountIds) {
      if (id === message.senderId) continue;
      if (!(await presence.online(id))) recipients.push(id);
    }
    if (recipients.length === 0) return;

    const payload: PushPayload = {
      title: await resolveTitle(message.senderId),
      body: preview(message.content),
      conversationId: message.conversationId,
    };
    const body = JSON.stringify(payload);
    const send = getPushSender();

    for (const accountId of recipients) {
      for (const sub of await listSubscriptions(accountId)) {
        const result = await send(sub, body);
        if (result === 'gone') await deleteByEndpoint(sub.endpoint);
      }
    }
  } catch (err) {
    appLog().error(
      { err, conversationId: message.conversationId },
      'push dispatch failed',
    );
  }
}

// Notification title: bot name for a bot reply, else the human sender's username.
async function resolveTitle(senderId: string): Promise<string> {
  const bot = getBot(senderId);
  if (bot) return bot.name;
  const { rows } = await query<{ username: string }>(
    'SELECT username FROM accounts WHERE id = $1',
    [senderId],
  );
  return rows[0]?.username ?? 'New message';
}

function preview(content: string): string {
  const cp = [...content];
  return cp.length <= PREVIEW_MAX ? content : cp.slice(0, PREVIEW_MAX).join('');
}
