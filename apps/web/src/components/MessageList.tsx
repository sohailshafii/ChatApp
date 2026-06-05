import { formatConversationTimestamp } from '../lib/time';
import type { DisplayMessage } from '../chat/messageReducer';

// Renders a conversation's messages oldest-first. Own messages align right,
// peer/bot messages left. Content is plain text with line breaks preserved.
export function MessageList({
  messages,
  ownId,
  peerLabel,
}: {
  messages: DisplayMessage[];
  ownId: string;
  peerLabel: string;
}) {
  return (
    <ol className="message-list">
      {messages.map((m) => {
        const mine = m.senderId === ownId;
        const failedBot = m.status === 'failed' && !mine;
        return (
          <li key={m.key} className={`message-row ${mine ? 'is-own' : 'is-peer'}`}>
            <div className="message-bubble">
              <span className="visually-hidden">{mine ? 'You' : peerLabel}:</span>
              {failedBot && m.content === '' ? (
                <p className="message-content message-failed">
                  ⚠ The assistant couldn’t reply.
                </p>
              ) : (
                <p className="message-content">
                  {m.content}
                  {m.status === 'streaming' && <span className="caret" aria-hidden="true">▋</span>}
                </p>
              )}
              <span className="message-meta">
                <time dateTime={m.createdAt}>
                  {formatConversationTimestamp(m.createdAt)}
                </time>
                {mine && <OwnStatus status={m.status} />}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
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
