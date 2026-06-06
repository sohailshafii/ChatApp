import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { FastifyInstance } from 'fastify';
import {
  clientWsMessageSchema,
  SESSION_COOKIE_NAME,
  type ServerWsMessage,
  type ClientWsMessage,
  type ErrorCode,
} from '@chatapp/shared';
import { loadConfig } from '../config.js';
import { touchSession } from '../auth/sessions.js';
import { hub } from './hub.js';
import {
  createMessage,
  getConversationParticipants,
} from '../conversations/messages.js';
import { streamBotReply } from '../bots/orchestrator.js';
import { dispatchMessagePush } from '../push/dispatcher.js';

// §3 WebSocket messaging server. Attached to Fastify's HTTP server via a manual
// `upgrade` handler so we control auth and fan-out explicitly (no Socket.IO).
//
// Bot reply streaming (bot_start/chunk/end) is defined in the protocol but
// produced by the bot-orchestration work (separate PR); a send into a bot
// conversation is persisted and acked here, without a reply.

const WS_PATH = '/ws';

const STATUS_TEXT: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  500: 'Internal Server Error',
};

export function registerWebSocket(app: FastifyInstance): void {
  const { appBaseUrl } = loadConfig();
  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) {
      socket.destroy();
      return;
    }
    authenticateUpgrade(req, appBaseUrl)
      .then((auth) => {
        if (!auth.ok) {
          rejectUpgrade(socket, auth.status);
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) =>
          onConnection(ws, auth.accountId),
        );
      })
      .catch(() => rejectUpgrade(socket, 500));
  });

  app.addHook('onClose', (_app, done) => {
    for (const client of wss.clients) client.terminate();
    wss.close(() => done());
  });
}

// §6: the upgrade requires a same-origin request and a valid session cookie.
type UpgradeAuth = { ok: true; accountId: string } | { ok: false; status: number };

async function authenticateUpgrade(
  req: IncomingMessage,
  appBaseUrl: string,
): Promise<UpgradeAuth> {
  if (req.headers.origin !== appBaseUrl) return { ok: false, status: 403 };
  const token = sessionTokenFromCookies(req.headers.cookie);
  if (!token) return { ok: false, status: 401 };
  const user = await touchSession(token);
  if (!user) return { ok: false, status: 401 };
  return { ok: true, accountId: user.id };
}

function onConnection(ws: WebSocket, accountId: string): void {
  hub.add(accountId, ws);
  ws.on('message', (data) => void handleFrame(ws, accountId, data));
  ws.on('close', () => hub.remove(accountId, ws));
  ws.on('error', () => hub.remove(accountId, ws));
}

async function handleFrame(
  ws: WebSocket,
  accountId: string,
  data: RawData,
): Promise<void> {
  let json: unknown;
  try {
    json = JSON.parse(data.toString());
  } catch {
    sendFrame(ws, errorFrame('validation_error', 'Invalid JSON frame', null));
    return;
  }
  const parsed = clientWsMessageSchema.safeParse(json);
  if (!parsed.success) {
    sendFrame(
      ws,
      errorFrame(
        'validation_error',
        parsed.error.issues[0]?.message ?? 'Invalid frame',
        clientMessageIdOf(json),
      ),
    );
    return;
  }
  await handleSend(ws, accountId, parsed.data);
}

async function handleSend(
  ws: WebSocket,
  accountId: string,
  frame: ClientWsMessage,
): Promise<void> {
  const { conversationId, clientMessageId, content } = frame;

  const participants = await getConversationParticipants(conversationId);
  if (!participants || !participants.accountIds.includes(accountId)) {
    sendFrame(ws, errorFrame('not_found', 'Conversation not found', clientMessageId));
    return;
  }

  let result;
  try {
    result = await createMessage({
      conversationId,
      senderId: accountId,
      content,
      clientMessageId,
    });
  } catch {
    sendFrame(ws, errorFrame('internal_error', 'Could not send message', clientMessageId));
    return;
  }
  const { message, deduped } = result;

  // Ack the originating socket (carries the real clientMessageId for dedupe).
  sendFrame(ws, { type: 'ack', clientMessageId, message });

  // A retried send was already fanned out on the first attempt — don't re-deliver.
  if (deduped) return;

  // Fan out to every participant socket except the origin. Recipients didn't send
  // it, so the broadcast message carries a null clientMessageId.
  const broadcast: ServerWsMessage = {
    type: 'message',
    message: { ...message, clientMessageId: null },
  };
  let deliveredToPeer = false;
  for (const account of participants.accountIds) {
    for (const socket of hub.socketsForAccount(account)) {
      if (socket === ws) continue;
      sendFrame(socket, broadcast);
      if (account !== accountId) deliveredToPeer = true;
    }
  }

  // §3 delivery receipt: a human peer had at least one socket that received it.
  if (deliveredToPeer) {
    sendFrame(ws, { type: 'delivered', conversationId, messageId: message.id });
  }

  // §5: Web Push to any recipient with no live socket (closed tab). Best-effort.
  void dispatchMessagePush(message, participants.accountIds);

  // Bot conversation: stream the assistant reply (bot_start -> chunks -> bot_end),
  // fire-and-forget so the ack isn't held up.
  if (participants.botId) {
    void streamBotReply(conversationId, participants.botId);
  }
}

function sendFrame(ws: WebSocket, frame: ServerWsMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function errorFrame(
  code: ErrorCode,
  message: string,
  clientMessageId: string | null,
): ServerWsMessage {
  return { type: 'error', code, message, clientMessageId };
}

function clientMessageIdOf(json: unknown): string | null {
  if (json && typeof json === 'object' && 'clientMessageId' in json) {
    const value = (json as Record<string, unknown>).clientMessageId;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function sessionTokenFromCookies(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function rejectUpgrade(socket: Duplex, status: number): void {
  const text = STATUS_TEXT[status] ?? 'Error';
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
