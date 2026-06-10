import type { BotErrorCode } from '@chatapp/shared';
import { formatAbsoluteTimestamp, formatRelativeTime } from '../lib/time';
import { useNow } from '../lib/useNow';
import type { DisplayMessage } from '../chat/messageReducer';
import { buildMessageRows } from '../chat/messageGrouping';
import { MessageText } from './MessageText';

// Renders a conversation's messages oldest-first, grouped into day buckets with
// date dividers and tightened spacing within same-sender runs. Own messages
// align right, peer/bot messages left. Content is plain text with line breaks
// preserved.
export function MessageList({
  messages,
  ownId,
  peerLabel,
}: {
  messages: DisplayMessage[];
  ownId: string;
  peerLabel: string;
}) {
  const rows = buildMessageRows(messages);
  // One ticker re-renders the list each minute so "x min ago" stays current.
  const now = useNow(30_000);
  return (
    <ol className="message-list">
      {rows.map((row) =>
        row.kind === 'divider' ? (
          <li key={row.key} className="message-divider">
            <span>{row.label}</span>
          </li>
        ) : (
          <MessageRow
            key={row.key}
            message={row.message}
            startsGroup={row.startsGroup}
            ownId={ownId}
            peerLabel={peerLabel}
            now={now}
          />
        ),
      )}
    </ol>
  );
}

function MessageRow({
  message: m,
  startsGroup,
  ownId,
  peerLabel,
  now,
}: {
  message: DisplayMessage;
  startsGroup: boolean;
  ownId: string;
  peerLabel: string;
  now: Date;
}) {
  const mine = m.senderId === ownId;
  const failedBot = m.status === 'failed' && !mine;
  // A bot reply that has started streaming but has no text yet — show a typing
  // indicator rather than an empty bubble.
  const typing = m.status === 'streaming' && m.content === '';
  return (
    <li
      className={`message-row ${mine ? 'is-own' : 'is-peer'}${
        startsGroup ? ' is-group-start' : ''
      }`}
    >
      <div className="message-bubble">
        <span className="visually-hidden">{mine ? 'You' : peerLabel}:</span>
        {failedBot ? (
          <>
            {m.content !== '' && (
              <p className="message-content">
                <MessageText text={m.content} />
              </p>
            )}
            <p className="message-content message-failed">
              ⚠ {botErrorMessage(m.errorCode)}
            </p>
          </>
        ) : typing ? (
          <p className="message-content">
            <span className="visually-hidden">{peerLabel} is typing…</span>
            <TypingDots />
          </p>
        ) : (
          <p className="message-content">
            <MessageText text={m.content} />
            {m.status === 'streaming' && <span className="caret" aria-hidden="true">▋</span>}
          </p>
        )}
        {!typing && (
          <span className="message-meta">
            <time dateTime={m.createdAt} title={formatAbsoluteTimestamp(m.createdAt)}>
              {formatRelativeTime(m.createdAt, now)}
            </time>
            {mine && <OwnStatus status={m.status} />}
          </span>
        )}
      </div>
    </li>
  );
}

// Animated "typing" dots shown while a bot reply is streaming but still empty.
function TypingDots() {
  return (
    <span className="typing-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

// User-facing copy for a failed bot reply, branched on the machine-readable
// reason (§3). `budget_exceeded` is terminal for the day; the others are
// transient and worth retrying.
function botErrorMessage(code: BotErrorCode | undefined): string {
  switch (code) {
    case 'budget_exceeded':
      return 'You’ve reached your daily limit for assistant replies. Please try again tomorrow.';
    case 'provider_unavailable':
      return 'The assistant is temporarily unavailable. Please try again in a moment.';
    default:
      // internal_error, or a failure with no code attached.
      return 'The assistant couldn’t reply. Please try again.';
  }
}

function OwnStatus({ status }: { status: DisplayMessage['status'] }) {
  const label =
    status === 'sending'
      ? 'Sending…'
      : status === 'failed'
        ? 'Failed'
        : status === 'delivered'
          ? 'Delivered'
          : status === 'sent'
            ? 'Sent'
            : '';
  if (!label) return null;
  return (
    <span className={`message-status${status === 'failed' ? ' is-failed' : ''}`}>
      {' · '}
      {label}
    </span>
  );
}
