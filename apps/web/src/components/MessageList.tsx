import type { Message } from '@chatapp/shared';
import { formatConversationTimestamp } from '../lib/time';

// Renders a conversation's messages oldest-first. Own messages align right,
// peer/bot messages left. Content is plain text with line breaks preserved
// (URL auto-linking comes with the messaging slice).
export function MessageList({
  messages,
  ownId,
  peerLabel,
}: {
  messages: Message[];
  ownId: string;
  peerLabel: string;
}) {
  return (
    <ol className="message-list">
      {messages.map((m) => {
        const mine = m.senderId === ownId;
        return (
          <li key={m.id} className={`message-row ${mine ? 'is-own' : 'is-peer'}`}>
            <div className="message-bubble">
              <span className="visually-hidden">{mine ? 'You' : peerLabel}:</span>
              <p className="message-content">{m.content}</p>
              <time className="message-time" dateTime={m.createdAt}>
                {formatConversationTimestamp(m.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
