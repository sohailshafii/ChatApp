import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE_NAME } from '@chatapp/shared';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/pool.js';
import { hashPassword } from '../auth/passwords.js';
import { createSession } from '../auth/sessions.js';
import { loadConfig } from '../config.js';
import {
  BotError,
  setBotProvider,
  type BotProvider,
  type BotUsage,
} from '../bots/provider.js';
import { TOKEN_BUDGET } from '../bots/budget.js';
import {
  botLimiter,
  botInvocationKey,
  BOT_LIMITS,
} from '../rate-limit/bot-rate-limit.js';
import {
  messageLimiter,
  messageSendKey,
  MESSAGE_LIMITS,
} from '../rate-limit/message-rate-limit.js';

const ORIGIN = loadConfig().appBaseUrl;

let app: FastifyInstance;
let wsUrl: string;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  app = buildApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  wsUrl = `ws://127.0.0.1:${port}/api/ws`;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

afterEach(async () => {
  for (const ws of sockets) {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
  sockets.length = 0;
  setBotProvider(undefined); // clear any per-test provider override
  botLimiter.reset(); // don't let a saturated bot-invocation window leak
  messageLimiter.reset();
  await query('TRUNCATE accounts, conversations RESTART IDENTITY CASCADE');
});

// A provider whose stream throws before yielding — exercises the bot_error path.
function throwingProvider(err: unknown): BotProvider {
  return {
    // eslint-disable-next-line require-yield
    async *streamReply(): AsyncGenerator<string, BotUsage, void> {
      throw err;
    },
  };
}

// A provider that streams a fixed reply and reports a known token usage.
function usageProvider(text: string, usage: BotUsage): BotProvider {
  return {
    async *streamReply(): AsyncGenerator<string, BotUsage, void> {
      yield text;
      return usage;
    },
  };
}

async function createUser(
  username: string,
): Promise<{ id: string; token: string }> {
  const passwordHash = await hashPassword('password-12345');
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (username, email, password_hash, verified)
     VALUES ($1, $2, $3, true) RETURNING id`,
    [username, `${username}@example.com`, passwordHash],
  );
  const id = rows[0]!.id;
  const token = await createSession(id);
  return { id, token };
}

async function createConversation(a: string, b: string): Promise<string> {
  const { rows } = await query<{ id: string }>(
    'INSERT INTO conversations DEFAULT VALUES RETURNING id',
  );
  const id = rows[0]!.id;
  await query(
    `INSERT INTO conversation_participants (conversation_id, account_id)
     VALUES ($1, $2), ($1, $3)`,
    [id, a, b],
  );
  return id;
}

async function createBotConversation(
  accountId: string,
  botId: string,
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    'INSERT INTO conversations (bot_id) VALUES ($1) RETURNING id',
    [botId],
  );
  const id = rows[0]!.id;
  await query(
    'INSERT INTO conversation_participants (conversation_id, account_id) VALUES ($1, $2)',
    [id, accountId],
  );
  return id;
}

// A connected client with a frame queue: next() awaits the next server frame.
function connect(token: string, origin: string = ORIGIN) {
  const ws = new WebSocket(wsUrl, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, origin },
  });
  sockets.push(ws);
  const queue: unknown[] = [];
  let waiter: ((frame: unknown) => void) | null = null;
  ws.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(frame);
    } else {
      queue.push(frame);
    }
  });
  return {
    ws,
    opened: () =>
      new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    next: (timeoutMs = 2000): Promise<any> =>
      new Promise((resolve, reject) => {
        const queued = queue.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        const timer = setTimeout(
          () => reject(new Error('timed out waiting for a frame')),
          timeoutMs,
        );
        waiter = (frame) => {
          clearTimeout(timer);
          resolve(frame);
        };
      }),
    send: (obj: unknown) => ws.send(JSON.stringify(obj)),
  };
}

// Asserts the upgrade is refused (no 101): ws emits 'error' or 'unexpected-response'.
function expectRejected(headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers });
    sockets.push(ws);
    ws.on('open', () => reject(new Error('expected the upgrade to be rejected')));
    ws.on('error', () => resolve());
    ws.on('unexpected-response', () => resolve());
  });
}

describe('WebSocket upgrade auth (§6)', () => {
  it('rejects without a session cookie', async () => {
    await expectRejected({ origin: ORIGIN });
  });

  it('rejects a foreign Origin', async () => {
    const alice = await createUser('alice');
    await expectRejected({
      cookie: `${SESSION_COOKIE_NAME}=${alice.token}`,
      origin: 'https://evil.example',
    });
  });

  it('rejects an invalid session token', async () => {
    await expectRejected({
      cookie: `${SESSION_COOKIE_NAME}=not-a-real-token`,
      origin: ORIGIN,
    });
  });
});

describe('WebSocket messaging (§3)', () => {
  it('acks the sender and fans the message out to the peer with a delivery receipt', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');
    const conv = await createConversation(alice.id, bob.id);
    const a = connect(alice.token);
    const b = connect(bob.token);
    await a.opened();
    await b.opened();

    a.send({
      type: 'send',
      conversationId: conv,
      clientMessageId: 'c1',
      content: 'hi bob',
    });

    const ack = await a.next();
    expect(ack.type).toBe('ack');
    expect(ack.clientMessageId).toBe('c1');
    expect(ack.message.content).toBe('hi bob');
    expect(ack.message.senderId).toBe(alice.id);
    expect(ack.message.clientMessageId).toBe('c1');
    expect(typeof ack.message.createdAt).toBe('string');

    const peer = await b.next();
    expect(peer.type).toBe('message');
    expect(peer.message.id).toBe(ack.message.id);
    expect(peer.message.content).toBe('hi bob');
    expect(peer.message.clientMessageId).toBeNull();

    const delivered = await a.next();
    expect(delivered).toMatchObject({
      type: 'delivered',
      conversationId: conv,
      messageId: ack.message.id,
    });
  });

  it("fans out to the sender's other tabs (no clientMessageId)", async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');
    const conv = await createConversation(alice.id, bob.id);
    const a1 = connect(alice.token);
    const a2 = connect(alice.token);
    await a1.opened();
    await a2.opened();

    a1.send({
      type: 'send',
      conversationId: conv,
      clientMessageId: 'c1',
      content: 'hello',
    });

    expect((await a1.next()).type).toBe('ack');
    const onOtherTab = await a2.next();
    expect(onOtherTab.type).toBe('message');
    expect(onOtherTab.message.content).toBe('hello');
    expect(onOtherTab.message.clientMessageId).toBeNull();
  });

  it('is idempotent on clientMessageId — a retry returns the same message', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');
    const conv = await createConversation(alice.id, bob.id);
    const a = connect(alice.token);
    await a.opened();

    a.send({ type: 'send', conversationId: conv, clientMessageId: 'dup', content: 'once' });
    const ack1 = await a.next();
    a.send({ type: 'send', conversationId: conv, clientMessageId: 'dup', content: 'once' });
    const ack2 = await a.next();

    expect(ack1.type).toBe('ack');
    expect(ack2.type).toBe('ack');
    expect(ack2.message.id).toBe(ack1.message.id);

    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1',
      [conv],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('rejects a send to a conversation the user is not part of', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');
    const carol = await createUser('carol');
    const conv = await createConversation(alice.id, bob.id);
    const c = connect(carol.token);
    await c.opened();

    c.send({
      type: 'send',
      conversationId: conv,
      clientMessageId: 'c1',
      content: 'intrude',
    });
    const err = await c.next();
    expect(err.type).toBe('error');
    expect(err.code).toBe('not_found');
    expect(err.clientMessageId).toBe('c1');
  });

  it('rejects a malformed frame with a validation error (echoing clientMessageId)', async () => {
    const alice = await createUser('alice');
    const a = connect(alice.token);
    await a.opened();

    a.send({
      type: 'send',
      conversationId: 'not-a-uuid',
      clientMessageId: 'c1',
      content: 'x',
    });
    const err = await a.next();
    expect(err.type).toBe('error');
    expect(err.code).toBe('validation_error');
    expect(err.clientMessageId).toBe('c1');
  });

  it('rate-limits a flood of sends with error{rate_limited}, persisting nothing', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');
    const conv = await createConversation(alice.id, bob.id);
    // Saturate alice's send window directly (avoids sending 30 frames).
    for (let i = 0; i < MESSAGE_LIMITS.send.max; i++) {
      await messageLimiter.check(messageSendKey(alice.id), MESSAGE_LIMITS.send);
    }
    const a = connect(alice.token);
    await a.opened();

    a.send({ type: 'send', conversationId: conv, clientMessageId: 'c1', content: 'flood' });
    const err = await a.next();
    expect(err.type).toBe('error');
    expect(err.code).toBe('rate_limited');
    expect(err.clientMessageId).toBe('c1');

    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1',
      [conv],
    );
    expect(rows[0]!.n).toBe(0); // nothing persisted
  });
});

describe('WebSocket bot replies (§3)', () => {
  it('streams a bot reply (bot_start -> chunks -> bot_end) and persists it', async () => {
    const alice = await createUser('alice');
    const conv = await createBotConversation(alice.id, 'assistant');
    const a = connect(alice.token);
    await a.opened();

    a.send({
      type: 'send',
      conversationId: conv,
      clientMessageId: 'c1',
      content: 'hello bot',
    });

    expect((await a.next()).type).toBe('ack');

    const start = await a.next();
    expect(start.type).toBe('bot_start');
    expect(start.conversationId).toBe(conv);
    const messageId = start.messageId;

    let streamed = '';
    let frame = await a.next();
    while (frame.type === 'bot_chunk') {
      expect(frame.messageId).toBe(messageId);
      streamed += frame.delta;
      frame = await a.next();
    }

    expect(frame.type).toBe('bot_end');
    expect(frame.message.id).toBe(messageId);
    expect(frame.message.senderId).toBe('assistant');
    expect(frame.message.content.length).toBeGreaterThan(0);
    expect(streamed).toBe(frame.message.content); // chunks reassemble the message

    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND sender_id = 'assistant'",
      [conv],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('emits bot_error with the BotError code on a provider failure', async () => {
    setBotProvider(
      throwingProvider(new BotError('provider_unavailable', 'upstream down')),
    );
    const alice = await createUser('alice');
    const conv = await createBotConversation(alice.id, 'assistant');
    const a = connect(alice.token);
    await a.opened();

    a.send({ type: 'send', conversationId: conv, clientMessageId: 'c1', content: 'hi' });
    expect((await a.next()).type).toBe('ack');
    expect((await a.next()).type).toBe('bot_start');

    const err = await a.next();
    expect(err.type).toBe('bot_error');
    expect(err.conversationId).toBe(conv);
    expect(err.code).toBe('provider_unavailable');

    // No assistant message is persisted on failure.
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND sender_id = 'assistant'",
      [conv],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('maps a non-BotError failure to code internal_error', async () => {
    setBotProvider(throwingProvider(new Error('boom')));
    const alice = await createUser('alice');
    const conv = await createBotConversation(alice.id, 'assistant');
    const a = connect(alice.token);
    await a.opened();

    a.send({ type: 'send', conversationId: conv, clientMessageId: 'c1', content: 'hi' });
    expect((await a.next()).type).toBe('ack');
    expect((await a.next()).type).toBe('bot_start');

    const err = await a.next();
    expect(err.type).toBe('bot_error');
    expect(err.code).toBe('internal_error');
  });

  it('blocks with budget_exceeded when the user is over their token budget', async () => {
    const alice = await createUser('alice');
    // Pre-seed the current window's usage at the cap.
    await query(
      `INSERT INTO bot_usage (account_id, window_start, tokens_used)
       VALUES ($1, to_timestamp(floor(extract(epoch from now()) / 18000) * 18000), $2)`,
      [alice.id, TOKEN_BUDGET],
    );
    const conv = await createBotConversation(alice.id, 'assistant');
    const a = connect(alice.token);
    await a.opened();

    a.send({ type: 'send', conversationId: conv, clientMessageId: 'c1', content: 'hi' });
    expect((await a.next()).type).toBe('ack');
    expect((await a.next()).type).toBe('bot_start');

    const err = await a.next();
    expect(err.type).toBe('bot_error');
    expect(err.code).toBe('budget_exceeded');

    // No assistant reply persisted, and usage is unchanged (no model call).
    const msgs = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND sender_id = 'assistant'",
      [conv],
    );
    expect(msgs.rows[0]!.n).toBe(0);
    const used = await query<{ tokens_used: string }>(
      'SELECT tokens_used FROM bot_usage WHERE account_id = $1',
      [alice.id],
    );
    expect(Number(used.rows[0]!.tokens_used)).toBe(TOKEN_BUDGET);
  });

  it('blocks with rate_limited once the per-bot invocation window is full', async () => {
    const alice = await createUser('alice');
    // Saturate the (user, bot) window directly so we don't send 20 WS frames.
    const key = botInvocationKey(alice.id, 'assistant');
    for (let i = 0; i < BOT_LIMITS.invoke.max; i++) await botLimiter.check(key, BOT_LIMITS.invoke);

    const conv = await createBotConversation(alice.id, 'assistant');
    const a = connect(alice.token);
    await a.opened();

    a.send({ type: 'send', conversationId: conv, clientMessageId: 'c1', content: 'hi' });
    expect((await a.next()).type).toBe('ack');
    expect((await a.next()).type).toBe('bot_start');

    const err = await a.next();
    expect(err.type).toBe('bot_error');
    expect(err.code).toBe('rate_limited');

    // No reply persisted, and the budget was never touched (we never reached it).
    const msgs = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND sender_id = 'assistant'",
      [conv],
    );
    expect(msgs.rows[0]!.n).toBe(0);
    const used = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM bot_usage WHERE account_id = $1',
      [alice.id],
    );
    expect(used.rows[0]!.n).toBe(0);
  });

  it('records the reply token usage against the token budget', async () => {
    setBotProvider(usageProvider('hi there', { inputTokens: 3, outputTokens: 5 }));
    const alice = await createUser('alice');
    const conv = await createBotConversation(alice.id, 'assistant');
    const a = connect(alice.token);
    await a.opened();

    a.send({ type: 'send', conversationId: conv, clientMessageId: 'c1', content: 'hi' });
    expect((await a.next()).type).toBe('ack');
    expect((await a.next()).type).toBe('bot_start');

    let frame = await a.next();
    while (frame.type === 'bot_chunk') frame = await a.next();
    expect(frame.type).toBe('bot_end');

    // Usage is recorded after bot_end (best-effort, fire-and-forget), so poll
    // briefly for the row rather than racing the write.
    let tokens = 0;
    for (let i = 0; i < 20 && tokens === 0; i++) {
      const used = await query<{ tokens_used: string }>(
        'SELECT tokens_used FROM bot_usage WHERE account_id = $1',
        [alice.id],
      );
      tokens = used.rows[0] ? Number(used.rows[0].tokens_used) : 0;
      if (tokens === 0) await new Promise((r) => setTimeout(r, 25));
    }
    expect(tokens).toBe(8); // 3 input + 5 output
  });
});
