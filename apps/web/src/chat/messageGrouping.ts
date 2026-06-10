import { dayKey, formatDayLabel } from '../lib/time';
import type { DisplayMessage } from './messageReducer';

// Flattens the message list into render rows: a date divider before the first
// message of each local day, and a `startsGroup` flag on the first message of
// each run (so the view can tighten spacing within a run and breathe between
// runs/days). A run breaks on a new day, a different sender, or a long pause
// since the previous message. Pure so it can be unit-tested.

// Same-sender messages more than this far apart start a new visual group.
const GROUP_GAP_MS = 5 * 60 * 1000;

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
  let prevTime: number | null = null;

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
    const time = new Date(message.createdAt).getTime();
    const longGap =
      prevTime !== null &&
      !Number.isNaN(time) &&
      time - prevTime > GROUP_GAP_MS;
    const startsGroup = newDay || message.senderId !== prevSender || longGap;
    rows.push({ kind: 'message', key: message.key, message, startsGroup });
    prevDay = day;
    prevSender = message.senderId;
    prevTime = Number.isNaN(time) ? prevTime : time;
  }

  return rows;
}
