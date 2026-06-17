import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { query, closePool } from '../db/pool.js';
import { buildExport, enqueueExport, processPendingExports } from './data-export.js';

// warn is used by sendDataExportEmail when RESEND_API_KEY is unset (the test env).
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

let accountId: string;

beforeEach(async () => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (username, email, password_hash, verified)
     VALUES ('exporter', 'exporter@example.com', 'x', true) RETURNING id`,
  );
  accountId = rows[0]!.id;
});

afterEach(async () => {
  vi.clearAllMocks();
  await query('TRUNCATE accounts RESTART IDENTITY CASCADE'); // cascades to data_exports
});

afterAll(async () => {
  await closePool();
});

describe('data export jobs', () => {
  it('enqueueExport inserts a pending job with no token/content', async () => {
    await enqueueExport(accountId);
    const { rows } = await query<{
      status: string;
      token_hash: string | null;
      content: Buffer | null;
    }>(
      'SELECT status, token_hash, content FROM data_exports WHERE account_id = $1',
      [accountId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', token_hash: null, content: null });
  });

  it('processPendingExports turns a pending job into a ready archive', async () => {
    await enqueueExport(accountId);

    expect(await processPendingExports(log)).toBe(1);

    const { rows } = await query<{
      status: string;
      token_hash: string | null;
      content: Buffer | null;
      expires_at: Date | null;
    }>(
      'SELECT status, token_hash, content, expires_at FROM data_exports WHERE account_id = $1',
      [accountId],
    );
    expect(rows[0]!.status).toBe('ready');
    expect(rows[0]!.token_hash).not.toBeNull();
    expect(rows[0]!.content).not.toBeNull();
    expect(rows[0]!.expires_at).not.toBeNull();

    // Nothing left to process on the next pass.
    expect(await processPendingExports(log)).toBe(0);
  });

  it('processes only up to batchSize per pass', async () => {
    await enqueueExport(accountId);
    await enqueueExport(accountId);
    await enqueueExport(accountId);

    expect(await processPendingExports(log, 2)).toBe(2);
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM data_exports WHERE status = 'pending' AND account_id = $1",
      [accountId],
    );
    expect(rows[0]!.n).toBe(1); // one still pending
  });
});

describe('buildExport content', () => {
  async function makeAccount(username: string): Promise<string> {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO accounts (username, email, password_hash, verified)
       VALUES ($1, $2, 'x', true) RETURNING id`,
      [username, `${username}@example.com`],
    );
    return rows[0]!.id;
  }
  async function makeConversation(botId: string | null): Promise<string> {
    const { rows } = await query<{ id: string }>(
      'INSERT INTO conversations (bot_id) VALUES ($1) RETURNING id',
      [botId],
    );
    return rows[0]!.id;
  }
  async function addParticipant(convId: string, acct: string): Promise<void> {
    await query(
      'INSERT INTO conversation_participants (conversation_id, account_id) VALUES ($1, $2)',
      [convId, acct],
    );
  }
  async function addMessage(convId: string, senderId: string, content: string): Promise<void> {
    await query(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)',
      [convId, senderId, content],
    );
  }

  it('omits peer account UUIDs and labels senders by name', async () => {
    const peerId = await makeAccount('peer');

    // Human conversation: one message each way.
    const humanConv = await makeConversation(null);
    await addParticipant(humanConv, accountId);
    await addParticipant(humanConv, peerId);
    await addMessage(humanConv, accountId, 'hi peer');
    await addMessage(humanConv, peerId, 'hi exporter');

    // Bot conversation: the user and the Smith bot.
    const botConv = await makeConversation('smith');
    await addParticipant(botConv, accountId);
    await addMessage(botConv, accountId, 'hello bot');
    await addMessage(botConv, 'smith', 'cor blimey, guv');

    const archive = (await buildExport(accountId)) as {
      conversations: {
        peer: Record<string, string>;
        messages: { sender: string; content: string }[];
      }[];
    };

    // No internal account UUIDs anywhere in the serialized export.
    const json = JSON.stringify(archive);
    expect(json).not.toContain(accountId);
    expect(json).not.toContain(peerId);

    const human = archive.conversations.find((c) => c.peer.kind === 'human')!;
    expect(human.peer).toEqual({ kind: 'human', username: 'peer' });
    expect(human.peer).not.toHaveProperty('id');
    expect(human.messages.map((m) => m.sender)).toEqual(['you', 'peer']);

    const bot = archive.conversations.find((c) => c.peer.kind === 'bot')!;
    expect(bot.peer).toEqual({ kind: 'bot', name: 'Smith' });
    expect(bot.messages.map((m) => m.sender)).toEqual(['you', 'Smith']);
  });
});
