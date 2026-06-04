import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  conversationListResponseSchema,
  conversationResponseSchema,
  messagePageSchema,
  botListResponseSchema,
  startConversationResponseSchema,
  type ConversationListResponse,
  type ConversationResponse,
  type MessagePage,
  type BotListResponse,
  type StartConversationResponse,
} from '@chatapp/shared';
import { buildApp } from '../app.js';
import { query, closePool } from '../db/pool.js';
import { hashPassword } from '../auth/passwords.js';
import { createSession } from '../auth/sessions.js';
import { getBot, listBots } from '../bots/registry.js';
import { createMessage } from '../conversations/messages.js';

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

async function insertMessage(
  conversationId: string,
  senderId: string,
  content: string,
  opts: { clientMessageId?: string; createdAt?: Date } = {},
): Promise<{ id: string; created_at: Date }> {
  const { rows } = await query<{ id: string; created_at: Date }>(
    `INSERT INTO messages (conversation_id, sender_id, content, client_message_id, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [
      conversationId,
      senderId,
      content,
      opts.clientMessageId ?? null,
      opts.createdAt ?? new Date(),
    ],
  );
  return rows[0]!;
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

  it('populates last-message preview and unread count from the peer', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const convId = await createHumanConversation(alice.id, bob.id);
    await insertMessage(convId, bob.id, 'hello alice', {
      createdAt: new Date('2026-03-01T00:00:00Z'),
    });
    await insertMessage(convId, bob.id, 'are you there?', {
      createdAt: new Date('2026-03-01T00:01:00Z'),
    });

    const body = (await listFor(alice.cookie)).json() as ConversationListResponse;
    const convo = body.conversations[0]!;
    expect(convo.lastMessage?.preview).toBe('are you there?');
    expect(convo.unreadCount).toBe(2);
  });
});

describe('GET /conversations/:id', () => {
  it('returns the summary for a participant (matches the wire schema)', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const convId = await createHumanConversation(alice.id, bob.id);

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${convId}`,
      headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(conversationResponseSchema.safeParse(res.json()).success).toBe(true);
    expect((res.json() as ConversationResponse).conversation.id).toBe(convId);
  });

  it('404s for a non-participant', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const carol = await createUserWithSession('carol');
    const convId = await createHumanConversation(bob.id, carol.id);

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${convId}`,
      headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('404s for a malformed/unknown id and 401s without a session', async () => {
    const alice = await createUserWithSession('alice');
    const bad = await app.inject({
      method: 'GET',
      url: '/conversations/not-a-uuid',
      headers: { cookie: alice.cookie },
    });
    expect(bad.statusCode).toBe(404);
    const unknown = await app.inject({
      method: 'GET',
      url: `/conversations/${randomUUID()}`,
      headers: { cookie: alice.cookie },
    });
    expect(unknown.statusCode).toBe(404);
    const anon = await app.inject({
      method: 'GET',
      url: `/conversations/${randomUUID()}`,
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('GET /conversations/:id/messages', () => {
  it('returns history oldest-first, server-timestamp ordered', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const convId = await createHumanConversation(alice.id, bob.id);
    await insertMessage(convId, alice.id, 'first', {
      createdAt: new Date('2026-03-01T00:00:00Z'),
    });
    await insertMessage(convId, bob.id, 'second', {
      createdAt: new Date('2026-03-01T00:01:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${convId}/messages`,
      headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(messagePageSchema.safeParse(res.json()).success).toBe(true);
    const page = res.json() as MessagePage;
    expect(page.messages.map((m) => m.content)).toEqual(['first', 'second']);
    expect(page.nextBefore).toBeNull();
  });

  it('paginates backward with the before cursor', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const convId = await createHumanConversation(alice.id, bob.id);
    for (let i = 0; i < 3; i++) {
      await insertMessage(convId, bob.id, `m${i}`, {
        createdAt: new Date(Date.UTC(2026, 2, 1, 0, i)),
      });
    }

    const first = (
      await app.inject({
        method: 'GET',
        url: `/conversations/${convId}/messages?limit=2`,
        headers: { cookie: alice.cookie },
      })
    ).json() as MessagePage;
    expect(first.messages.map((m) => m.content)).toEqual(['m1', 'm2']);
    expect(first.nextBefore).not.toBeNull();

    const second = (
      await app.inject({
        method: 'GET',
        url: `/conversations/${convId}/messages?limit=2&before=${first.nextBefore}`,
        headers: { cookie: alice.cookie },
      })
    ).json() as MessagePage;
    expect(second.messages.map((m) => m.content)).toEqual(['m0']);
    expect(second.nextBefore).toBeNull();
  });

  it('404s for a non-participant', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const carol = await createUserWithSession('carol');
    const convId = await createHumanConversation(bob.id, carol.id);

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${convId}/messages`,
      headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /conversations/:id/read', () => {
  const CSRF = 'csrf-double-submit-value';
  const authed = (cookie: string) => ({
    cookie: `${cookie}; ${CSRF_COOKIE_NAME}=${CSRF}`,
    [CSRF_HEADER_NAME]: CSRF,
  });

  it('requires the double-submit CSRF token', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const convId = await createHumanConversation(alice.id, bob.id);
    const m = await insertMessage(convId, bob.id, 'hi');

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convId}/read`,
      headers: { cookie: alice.cookie }, // no CSRF
      payload: { messageId: m.id },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf_failure');
  });

  it('advances the cursor and clears unread', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const convId = await createHumanConversation(alice.id, bob.id);
    await insertMessage(convId, bob.id, 'one', {
      createdAt: new Date('2026-03-01T00:00:00Z'),
    });
    const last = await insertMessage(convId, bob.id, 'two', {
      createdAt: new Date('2026-03-01T00:01:00Z'),
    });

    let body = (await listFor(alice.cookie)).json() as ConversationListResponse;
    expect(body.conversations[0]!.unreadCount).toBe(2);

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convId}/read`,
      headers: authed(alice.cookie),
      payload: { messageId: last.id },
    });
    expect(res.statusCode).toBe(204);

    body = (await listFor(alice.cookie)).json() as ConversationListResponse;
    expect(body.conversations[0]!.unreadCount).toBe(0);
  });

  it('404s when the message is not in the conversation', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const convId = await createHumanConversation(alice.id, bob.id);

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${convId}/read`,
      headers: authed(alice.cookie),
      payload: { messageId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });
});

const CSRF_VALUE = 'csrf-double-submit-value';
function csrfHeaders(cookie: string): Record<string, string> {
  return {
    cookie: `${cookie}; ${CSRF_COOKIE_NAME}=${CSRF_VALUE}`,
    [CSRF_HEADER_NAME]: CSRF_VALUE,
  };
}

describe('GET /bots', () => {
  it('returns the system bot registry (matches the wire schema)', async () => {
    const alice = await createUserWithSession('alice');
    const res = await app.inject({
      method: 'GET',
      url: '/bots',
      headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(botListResponseSchema.safeParse(res.json()).success).toBe(true);
    expect((res.json() as BotListResponse).bots.map((b) => b.id)).toEqual(
      listBots().map((b) => b.id),
    );
  });

  it('401s without a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/bots' })).statusCode).toBe(401);
  });
});

describe('POST /conversations', () => {
  const start = (cookie: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/conversations', headers: csrfHeaders(cookie), payload });

  it('starts a human conversation and is idempotent', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');

    const first = await start(alice.cookie, { peerKind: 'human', username: 'bob' });
    expect(first.statusCode).toBe(200);
    expect(startConversationResponseSchema.safeParse(first.json()).success).toBe(true);
    const c1 = (first.json() as StartConversationResponse).conversation;
    expect(c1.peer).toEqual({ kind: 'human', id: bob.id, username: 'bob' });

    const second = await start(alice.cookie, { peerKind: 'human', username: 'bob' });
    expect((second.json() as StartConversationResponse).conversation.id).toBe(c1.id);

    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM conversations',
    );
    expect(rows[0]!.n).toBe(1); // not duplicated
  });

  it('starts a bot conversation', async () => {
    const alice = await createUserWithSession('alice');
    const res = await start(alice.cookie, { peerKind: 'bot', botId: 'assistant' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as StartConversationResponse).conversation.peer).toEqual({
      kind: 'bot',
      id: 'assistant',
      name: getBot('assistant')!.name,
    });
  });

  it('returns generic not_found for unknown/unverified user, self, and unknown bot', async () => {
    const alice = await createUserWithSession('alice');
    await query(
      `INSERT INTO accounts (username, email, password_hash, verified)
       VALUES ('bob', 'bob@example.com', 'x', false)`,
    );
    for (const payload of [
      { peerKind: 'human', username: 'ghost' },
      { peerKind: 'human', username: 'bob' }, // exists but unverified
      { peerKind: 'human', username: 'alice' }, // self
      { peerKind: 'bot', botId: 'nope' },
    ]) {
      const res = await start(alice.cookie, payload);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
  });

  it('requires CSRF and a session', async () => {
    const alice = await createUserWithSession('alice');
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { cookie: alice.cookie },
      payload: { peerKind: 'human', username: 'bob' },
    });
    expect(noCsrf.statusCode).toBe(403);
    const anon = await app.inject({
      method: 'POST',
      url: '/conversations',
      payload: { peerKind: 'human', username: 'bob' },
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('DELETE /conversations/:id', () => {
  it('hides from the caller but not the peer; new activity un-hides', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const convId = await createHumanConversation(alice.id, bob.id);

    const del = await app.inject({
      method: 'DELETE',
      url: `/conversations/${convId}`,
      headers: csrfHeaders(alice.cookie),
    });
    expect(del.statusCode).toBe(204);

    expect((await listFor(alice.cookie)).json().conversations).toEqual([]);
    expect((await listFor(bob.cookie)).json().conversations).toHaveLength(1);

    // A new message re-surfaces it for alice.
    await createMessage({
      conversationId: convId,
      senderId: bob.id,
      content: 'back?',
      clientMessageId: 'm1',
    });
    expect((await listFor(alice.cookie)).json().conversations).toHaveLength(1);
  });

  it('un-hides when the conversation is started again', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const convId = await createHumanConversation(alice.id, bob.id);
    await app.inject({
      method: 'DELETE',
      url: `/conversations/${convId}`,
      headers: csrfHeaders(alice.cookie),
    });
    expect((await listFor(alice.cookie)).json().conversations).toEqual([]);

    const res = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: csrfHeaders(alice.cookie),
      payload: { peerKind: 'human', username: 'bob' },
    });
    expect((res.json() as StartConversationResponse).conversation.id).toBe(convId);
    expect((await listFor(alice.cookie)).json().conversations).toHaveLength(1);
  });

  it('404s for a non-participant and requires CSRF', async () => {
    const alice = await createUserWithSession('alice');
    const bob = await createUserWithSession('bob');
    const carol = await createUserWithSession('carol');
    const convId = await createHumanConversation(bob.id, carol.id);

    const notMine = await app.inject({
      method: 'DELETE',
      url: `/conversations/${convId}`,
      headers: csrfHeaders(alice.cookie),
    });
    expect(notMine.statusCode).toBe(404);

    const noCsrf = await app.inject({
      method: 'DELETE',
      url: `/conversations/${convId}`,
      headers: { cookie: alice.cookie },
    });
    expect(noCsrf.statusCode).toBe(403);
  });
});
