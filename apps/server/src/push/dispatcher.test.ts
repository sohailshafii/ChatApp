import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { query, closePool } from '../db/pool.js';
import { hub } from '../ws/hub.js';
import { dispatchMessagePush } from './dispatcher.js';
import { setPushSender, type PushResult } from './sender.js';

let aliceId: string;
let bobId: string;
const sent: { endpoint: string; payload: string }[] = [];
const fakeSockets: { accountId: string; socket: WebSocket }[] = [];

beforeEach(async () => {
  const ins = async (u: string) =>
    (
      await query<{ id: string }>(
        `INSERT INTO accounts (username, email, password_hash, verified)
         VALUES ($1, $2, 'x', true) RETURNING id`,
        [u, `${u}@example.com`],
      )
    ).rows[0]!.id;
  aliceId = await ins('alice');
  bobId = await ins('bob');
  // Default fake sender: succeeds, records the call.
  setPushSender(async (sub, payload): Promise<PushResult> => {
    sent.push({ endpoint: sub.endpoint, payload });
    return 'sent';
  });
});

afterEach(async () => {
  setPushSender(undefined);
  for (const { accountId, socket } of fakeSockets) hub.remove(accountId, socket);
  fakeSockets.length = 0;
  sent.length = 0;
  await query('TRUNCATE accounts RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closePool();
});

function goOnline(accountId: string): void {
  const socket = {} as unknown as WebSocket;
  hub.add(accountId, socket);
  fakeSockets.push({ accountId, socket });
}

async function seedSubscription(accountId: string, endpoint: string): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (endpoint, account_id, p256dh, auth)
     VALUES ($1, $2, 'p', 'a')`,
    [endpoint, accountId],
  );
}

describe('dispatchMessagePush', () => {
  it('pushes to an offline recipient with the sender username as the title', async () => {
    await seedSubscription(bobId, 'https://push.example.com/bob');
    const conversationId = randomUUID();

    await dispatchMessagePush(
      { conversationId, senderId: aliceId, content: 'hello world' },
      [aliceId, bobId],
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]!.endpoint).toBe('https://push.example.com/bob');
    expect(JSON.parse(sent[0]!.payload)).toEqual({
      title: 'alice',
      body: 'hello world',
      conversationId,
    });
  });

  it('does not push to an online recipient', async () => {
    await seedSubscription(bobId, 'https://push.example.com/bob');
    goOnline(bobId);

    await dispatchMessagePush(
      { conversationId: randomUUID(), senderId: aliceId, content: 'hi' },
      [aliceId, bobId],
    );
    expect(sent).toHaveLength(0);
  });

  it('uses the bot name as the title for a bot reply', async () => {
    await seedSubscription(bobId, 'https://push.example.com/bob');

    await dispatchMessagePush(
      { conversationId: randomUUID(), senderId: 'assistant', content: 'a reply' },
      [bobId], // the human; the bot is not a participant account
    );
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.payload).title).toBe('Grik');
  });

  it('prunes a subscription the push service reports as gone (404/410)', async () => {
    await seedSubscription(bobId, 'https://push.example.com/dead');
    setPushSender(async () => 'gone');

    await dispatchMessagePush(
      { conversationId: randomUUID(), senderId: aliceId, content: 'x' },
      [aliceId, bobId],
    );
    const rows = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM push_subscriptions WHERE account_id = $1',
      [bobId],
    );
    expect(rows.rows[0]!.n).toBe(0);
  });
});
