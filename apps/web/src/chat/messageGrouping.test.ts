import { describe, expect, it } from 'vitest';
import { buildMessageRows } from './messageGrouping';
import type { DisplayMessage } from './messageReducer';

const NOW = new Date(2026, 5, 9, 12, 0); // Jun 9 2026, local

function iso(y: number, mo: number, d: number, h = 10): string {
  return new Date(y, mo, d, h, 0).toISOString();
}

function msg(
  p: { key: string; senderId: string; createdAt: string } & Partial<DisplayMessage>,
): DisplayMessage {
  return { id: null, content: 'hi', clientMessageId: null, status: 'sent', ...p };
}

describe('buildMessageRows', () => {
  it('returns nothing for no messages', () => {
    expect(buildMessageRows([], NOW)).toEqual([]);
  });

  it('puts a day divider before the first message of a day', () => {
    const rows = buildMessageRows(
      [msg({ key: 'a', senderId: 'u1', createdAt: iso(2026, 5, 9) })],
      NOW,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'divider', label: 'Today' });
    expect(rows[1]).toMatchObject({ kind: 'message', startsGroup: true });
  });

  it('groups consecutive same-sender messages (only the first starts a group)', () => {
    const rows = buildMessageRows(
      [
        msg({ key: 'a', senderId: 'u1', createdAt: iso(2026, 5, 9, 10) }),
        msg({ key: 'b', senderId: 'u1', createdAt: iso(2026, 5, 9, 11) }),
        msg({ key: 'c', senderId: 'u2', createdAt: iso(2026, 5, 9, 12) }),
      ],
      NOW,
    );
    // divider, a(start), b(cont), c(start)
    expect(rows.map((r) => r.kind)).toEqual(['divider', 'message', 'message', 'message']);
    expect(rows[1]).toMatchObject({ key: 'a', startsGroup: true });
    expect(rows[2]).toMatchObject({ key: 'b', startsGroup: false });
    expect(rows[3]).toMatchObject({ key: 'c', startsGroup: true });
  });

  it('starts a new day with a divider and a fresh group even for the same sender', () => {
    const rows = buildMessageRows(
      [
        msg({ key: 'a', senderId: 'u1', createdAt: iso(2026, 5, 8) }),
        msg({ key: 'b', senderId: 'u1', createdAt: iso(2026, 5, 9) }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.kind)).toEqual(['divider', 'message', 'divider', 'message']);
    expect(rows[0]).toMatchObject({ label: 'Yesterday' });
    expect(rows[2]).toMatchObject({ label: 'Today' });
    expect(rows[3]).toMatchObject({ key: 'b', startsGroup: true });
  });
});
