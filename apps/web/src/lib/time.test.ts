import { describe, expect, it } from 'vitest';
import { formatConversationTimestamp } from './time';

// Fixed reference "now": Mon Jun 15 2026, 12:00 local.
const now = new Date(2026, 5, 15, 12, 0, 0);

// Build a local-time ISO string for an explicit calendar moment.
function localIso(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m, d, h, min).toISOString();
}

describe('formatConversationTimestamp', () => {
  it('shows the time for a timestamp earlier today', () => {
    expect(formatConversationTimestamp(localIso(2026, 5, 15, 9, 30), now)).toBe('9:30 AM');
    expect(formatConversationTimestamp(localIso(2026, 5, 15, 15, 5), now)).toBe('3:05 PM');
  });

  it('shows midnight and noon with a 12-hour clock', () => {
    expect(formatConversationTimestamp(localIso(2026, 5, 15, 0, 0), now)).toBe('12:00 AM');
    expect(formatConversationTimestamp(localIso(2026, 5, 15, 12, 0), now)).toBe('12:00 PM');
  });

  it('shows the weekday for the previous six days', () => {
    expect(formatConversationTimestamp(localIso(2026, 5, 14, 18, 0), now)).toBe('Sun');
    expect(formatConversationTimestamp(localIso(2026, 5, 9, 8, 0), now)).toBe('Tue');
  });

  it('shows month and day for older dates in the same year', () => {
    expect(formatConversationTimestamp(localIso(2026, 5, 2, 10, 0), now)).toBe('Jun 2');
    expect(formatConversationTimestamp(localIso(2026, 0, 1, 10, 0), now)).toBe('Jan 1');
  });

  it('includes the year for dates in a different year', () => {
    expect(formatConversationTimestamp(localIso(2025, 11, 31, 10, 0), now)).toBe('Dec 31, 2025');
  });

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatConversationTimestamp('not-a-date', now)).toBe('');
  });
});
