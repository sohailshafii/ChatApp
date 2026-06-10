const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Compact timestamp for a conversation-list row, in the spirit of messaging apps:
//  - today        -> time, e.g. "3:45 PM"
//  - last 7 days  -> weekday, e.g. "Mon"
//  - older        -> "Jun 2" (with year if a different year)
// Formatted manually (English, local time) so it's deterministic and testable;
// i18n is deferred per the spec.
export function formatConversationTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);

  if (dayDiff <= 0) {
    const ampm = d.getHours() < 12 ? 'AM' : 'PM';
    const hour = d.getHours() % 12 || 12;
    const minute = String(d.getMinutes()).padStart(2, '0');
    return `${hour}:${minute} ${ampm}`;
  }
  if (dayDiff < 7) {
    return WEEKDAYS[d.getDay()]!;
  }
  const label = `${MONTHS[d.getMonth()]!} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear()
    ? label
    : `${label}, ${d.getFullYear()}`;
}

// Relative, self-updating label for a message timestamp:
//   < 1 min  -> "just now"
//   < 1 hr   -> "5 min ago"
//   < 1 day  -> "3 hr ago"
//   < 1 week -> "2 days ago"
//   older    -> falls back to the compact absolute form ("Jun 2").
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;

  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;

  return formatConversationTimestamp(iso, now);
}

// Full, unambiguous timestamp for a tooltip, e.g. "Jun 2, 2026, 3:45 PM".
export function formatAbsoluteTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  const hour = d.getHours() % 12 || 12;
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]!} ${d.getDate()}, ${d.getFullYear()}, ${hour}:${minute} ${ampm}`;
}

// Stable local-day key for grouping messages into day buckets.
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Label for a date divider in a conversation:
//  - today / yesterday -> "Today" / "Yesterday"
//  - older this year   -> "Mon, Jun 2"
//  - older other year  -> "Jun 2, 2025"
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);

  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';

  const md = `${MONTHS[d.getMonth()]!} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear()
    ? `${WEEKDAYS[d.getDay()]!}, ${md}`
    : `${md}, ${d.getFullYear()}`;
}
