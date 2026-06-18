import { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import type { ServerWsMessage } from '@chatapp/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hub } from './hub.js';
import { applyControlFromBus, deliverFromBus, RedisBus } from './bus.js';

// A fake socket: open, recording what it's sent and whether it was closed.
function fakeSocket(): WebSocket & { sent: string[]; closed: boolean } {
  const s = {
    readyState: WebSocket.OPEN,
    sent: [] as string[],
    closed: false,
    send: (p: string) => s.sent.push(p),
    close: () => {
      s.closed = true;
    },
  };
  return s as unknown as WebSocket & { sent: string[]; closed: boolean };
}

const frame: ServerWsMessage = {
  type: 'message',
  message: {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'u2',
    content: 'hi',
    createdAt: '2026-01-01T00:00:00.000Z',
    clientMessageId: null,
  },
};

afterEach(() => {
  for (const id of [...hub.accountIds()]) {
    for (const s of [...hub.socketsForAccount(id)]) hub.remove(id, s);
  }
});

describe('deliverFromBus', () => {
  it('delivers a frame from another machine to local sockets', () => {
    const s = fakeSocket();
    hub.add('u1', s);
    deliverFromBus(JSON.stringify({ o: 'other', a: ['u1'], f: frame }), 'me');
    expect(s.sent).toEqual([JSON.stringify(frame)]);
  });

  it('ignores frames this machine published (already delivered locally)', () => {
    const s = fakeSocket();
    hub.add('u1', s);
    deliverFromBus(JSON.stringify({ o: 'me', a: ['u1'], f: frame }), 'me');
    expect(s.sent).toEqual([]);
  });

  it('swallows malformed payloads', () => {
    expect(() => deliverFromBus('not json', 'me')).not.toThrow();
  });
});

describe('RedisBus.publish (local leg, no client)', () => {
  it('delivers to local sockets and skips the origin socket', () => {
    const origin = fakeSocket();
    const other = fakeSocket();
    hub.add('u1', origin);
    hub.add('u1', other);
    const b = new RedisBus(() => null); // no client -> local-only
    b.publish(['u1'], frame, origin);
    expect(origin.sent).toEqual([]); // origin tab skipped
    expect(other.sent).toEqual([JSON.stringify(frame)]); // other tab gets it
  });
});

describe('closeAccount / applyControlFromBus', () => {
  it('closeAccount closes local sockets (local leg, no client)', () => {
    const s = fakeSocket();
    hub.add('u1', s);
    new RedisBus(() => null).closeAccount('u1');
    expect(s.closed).toBe(true);
  });

  it('a close control from another machine closes local sockets', () => {
    const s = fakeSocket();
    hub.add('u1', s);
    applyControlFromBus(JSON.stringify({ o: 'other', type: 'close', a: 'u1' }), 'me');
    expect(s.closed).toBe(true);
  });

  it('ignores a close control this machine published', () => {
    const s = fakeSocket();
    hub.add('u1', s);
    applyControlFromBus(JSON.stringify({ o: 'me', type: 'close', a: 'u1' }), 'me');
    expect(s.closed).toBe(false);
  });
});

// Real-Redis coverage of the publish→channel path. Skipped unless TEST_REDIS_URL.
const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)('RedisBus over Redis', () => {
  let pub: Redis;
  let sub: Redis;
  beforeAll(() => {
    pub = new Redis(url!);
    sub = new Redis(url!);
  });
  afterAll(async () => {
    await pub.quit();
    await sub.quit();
  });

  it('publishes a tagged envelope on the bus channel', async () => {
    const received = new Promise<string>((resolve) => {
      sub.on('message', (_c, raw) => resolve(raw));
    });
    await sub.subscribe('ws:bus');
    const b = new RedisBus(() => pub, 'machine-A');
    b.publish(['u9'], frame); // no local sockets here; just exercises the publish
    const raw = await received;
    const env = JSON.parse(raw);
    expect(env.o).toBe('machine-A');
    expect(env.a).toEqual(['u9']);
    expect(env.f).toEqual(frame);
  });
});
