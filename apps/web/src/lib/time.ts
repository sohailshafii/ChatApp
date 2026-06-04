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
