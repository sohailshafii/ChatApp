import { describe, expect, it } from 'vitest';
import {
  dayKey,
  formatAbsoluteTimestamp,
  formatConversationTimestamp,
  formatDayLabel,
  formatRelativeTime,
} from './time';

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

describe('dayKey', () => {
  it('is stable across times on the same local day', () => {
    expect(dayKey(localIso(2026, 5, 15, 1))).toBe(dayKey(localIso(2026, 5, 15, 23)));
  });

  it('differs across days', () => {
    expect(dayKey(localIso(2026, 5, 15))).not.toBe(dayKey(localIso(2026, 5, 14)));
  });
});

describe('formatDayLabel', () => {
  it('labels today and yesterday', () => {
    expect(formatDayLabel(localIso(2026, 5, 15, 9), now)).toBe('Today');
    expect(formatDayLabel(localIso(2026, 5, 14, 9), now)).toBe('Yesterday');
  });

  it('uses weekday + month/day earlier in the same year', () => {
    // Jun 2 2026 is a Tuesday.
    expect(formatDayLabel(localIso(2026, 5, 2, 10), now)).toBe('Tue, Jun 2');
  });

  it('includes the year for a different year', () => {
    expect(formatDayLabel(localIso(2024, 5, 2, 10), now)).toBe('Jun 2, 2024');
  });
});

describe('formatRelativeTime', () => {
  const ref = new Date(2026, 5, 15, 12, 0, 0); // Mon Jun 15 2026, 12:00 local

  function ago(ms: number): string {
    return new Date(ref.getTime() - ms).toISOString();
  }
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HR = 60 * MIN;
  const DAY = 24 * HR;

  it('says "just now" under a minute', () => {
    expect(formatRelativeTime(ago(5 * SEC), ref)).toBe('just now');
    expect(formatRelativeTime(ago(59 * SEC), ref)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(formatRelativeTime(ago(1 * MIN), ref)).toBe('1 min ago');
    expect(formatRelativeTime(ago(5 * MIN), ref)).toBe('5 min ago');
    expect(formatRelativeTime(ago(2 * HR), ref)).toBe('2 hr ago');
    expect(formatRelativeTime(ago(1 * DAY), ref)).toBe('1 day ago');
    expect(formatRelativeTime(ago(3 * DAY), ref)).toBe('3 days ago');
  });

  it('falls back to an absolute date a week or more out', () => {
    expect(formatRelativeTime(ago(8 * DAY), ref)).toBe('Jun 7');
  });
});

describe('formatAbsoluteTimestamp', () => {
  it('renders a full date and 12-hour time', () => {
    expect(formatAbsoluteTimestamp(localIso(2026, 5, 2, 15, 45))).toBe('Jun 2, 2026, 3:45 PM');
    expect(formatAbsoluteTimestamp(localIso(2026, 0, 1, 0, 5))).toBe('Jan 1, 2026, 12:05 AM');
  });

  it('returns empty for an unparseable timestamp', () => {
    expect(formatAbsoluteTimestamp('nope')).toBe('');
  });
});
