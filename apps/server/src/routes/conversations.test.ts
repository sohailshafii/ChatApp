import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  conversationListResponseSchema,
  type ConversationListResponse,
} from '@chatapp/shared';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/pool.js';
import { hashPassword } from '../auth/passwords.js';
import { createSession } from '../auth/sessions.js';
import { getBot } from '../bots/registry.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

afterEach(async () => {
  // Truncating both roots cascades to participants, sessions, and tokens.
  await query('TRUNCATE accounts, conversations RESTART IDENTITY CASCADE');
});

// Creates a verified account with an active session; returns its id + Cookie header.
async function createUserWithSession(
  username: string,
): Promise<{ id: string; cookie: string }> {
  const passwordHash = await hashPassword('password-12345');
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (username, email, password_hash, verified)
     VALUES ($1, $2, $3, true) RETURNING id`,
    [username, `${username}@example.com`, passwordHash],
  );
  const id = rows[0]!.id;
  const token = await createSession(id);
  return { id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function createHumanConversation(
  a: string,
  b: string,
  updatedAt = new Date(),
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    'INSERT INTO conversations (updated_at) VALUES ($1) RETURNING id',
    [updatedAt],
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
  updatedAt = new Date(),
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    'INSERT INTO conversations (bot_id, updated_at) VALUES ($1, $2) RETURNING id',
    [botId, updatedAt],
  );
  const id = rows[0]!.id;
  await query(
    'INSERT INTO conversation_participants (conversation_id, account_id) VALUES ($1, $2)',
    [id, accountId],
  );
  return id;
}

function listFor(cookie: string) {
  return app.inject({ method: 'GET', url: '/conversations', headers: { cookie } });
}

describe('GET /conversations', () => {
  it('401s without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('returns an empty list for a user with no conversations', async () => {
    const alice = await createUserWithSession('alice');
    const res = await listFor(alice.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ conversations: [] });
  });

  it('returns a human conversation with the peer resolved (matches the wire schema)', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    await createHumanConversation(alice.id, bob.id);

    const res = await listFor(alice.cookie);
    expect(res.statusCode).toBe(200);
    expect(conversationListResponseSchema.safeParse(res.json()).success).toBe(true);

    const body = res.json() as ConversationListResponse;
    expect(body.conversations).toHaveLength(1);
    const convo = body.conversations[0]!;
    expect(convo.peer).toEqual({ kind: 'human', id: bob.id, username: 'bob' });
    expect(convo.lastMessage).toBeNull();
    expect(convo.unreadCount).toBe(0);
  });

  it('resolves a bot peer from the registry', async () => {
    const alice = await createUserWithSession('alice');
    await createBotConversation(alice.id, 'assistant');

    const body = (await listFor(alice.cookie)).json() as ConversationListResponse;
    expect(body.conversations[0]!.peer).toEqual({
      kind: 'bot',
      id: 'assistant',
      name: getBot('assistant')!.name,
    });
  });

  it('sorts by most recent activity (updatedAt desc)', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const older = await createHumanConversation(
      alice.id,
      bob.id,
      new Date('2026-01-01T00:00:00Z'),
    );
    const newer = await createBotConversation(
      alice.id,
      'assistant',
      new Date('2026-02-01T00:00:00Z'),
    );

    const body = (await listFor(alice.cookie)).json() as ConversationListResponse;
    expect(body.conversations.map((c) => c.id)).toEqual([newer, older]);
  });

  it("does not leak other users' conversations", async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const carol = await createUserWithSession('carol');
    await createHumanConversation(bob.id, carol.id); // alice is not a participant

    const body = (await listFor(alice.cookie)).json() as ConversationListResponse;
    expect(body.conversations).toEqual([]);
  });
});
