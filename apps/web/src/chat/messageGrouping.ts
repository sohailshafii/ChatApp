import { dayKey, formatDayLabel } from '../lib/time';
import type { DisplayMessage } from './messageReducer';

// Flattens the message list into render rows: a date divider before the first
// message of each local day, and a `startsGroup` flag on the first message of
// each consecutive same-sender run (so the view can tighten spacing within a
// run and breathe between runs/days). Pure so it can be unit-tested.

export type MessageRow =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'message'; key: string; message: DisplayMessage; startsGroup: boolean };

export function buildMessageRows(
  messages: DisplayMessage[],
  now: Date = new Date(),
): MessageRow[] {
  const rows: MessageRow[] = [];
  let prevDay: string | null = null;
  let prevSender: string | null = null;

  for (const message of messages) {
    const day = dayKey(message.createdAt);
    const newDay = day !== prevDay;
    if (newDay) {
      rows.push({
        kind: 'divider',
        key: `divider-${day}`,
        label: formatDayLabel(message.createdAt, now),
      });
    }
    const startsGroup = newDay || message.senderId !== prevSender;
    rows.push({ kind: 'message', key: message.key, message, startsGroup });
    prevDay = day;
    prevSender = message.senderId;
  }

  return rows;
}
