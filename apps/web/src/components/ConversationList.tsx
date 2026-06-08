import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConversationSummary } from '@chatapp/shared';
import { formatConversationTimestamp } from '../lib/time';
import { peerName } from '../lib/peer';
import { Avatar } from './Avatar';

export function ConversationList({
  conversations,
  onHide,
}: {
  conversations: ConversationSummary[];
  // Hide a conversation from the list (§2). Throws on failure so the row can
  // recover; the parent restores the row and surfaces the error.
  onHide: (id: string) => Promise<void>;
}) {
  if (conversations.length === 0) {
    return (
      <p className="empty">
        No conversations yet. New messages will show up here.
      </p>
    );
  }

  return (
    <ul className="conversation-list">
      {conversations.map((c) => (
        <li key={c.id}>
          <ConversationRow conversation={c} onHide={onHide} />
        </li>
      ))}
    </ul>
  );
}

function ConversationRow({
  conversation,
  onHide,
}: {
  conversation: ConversationSummary;
  onHide: (id: string) => Promise<void>;
}) {
  const name = peerName(conversation.peer);
  const { lastMessage, unreadCount } = conversation;
  const hasUnread = unreadCount > 0;
  const [hiding, setHiding] = useState(false);

  async function handleHide() {
    if (hiding) return;
    if (
      !window.confirm(
        'Hide this conversation? It will reappear if there is new activity.',
      )
    ) {
      return;
    }
    setHiding(true);
    try {
      await onHide(conversation.id);
      // On success the row is removed from the list and this component unmounts.
    } catch {
      setHiding(false);
    }
  }

  return (
    <div className={`conversation-row${hasUnread ? ' is-unread' : ''}`}>
      <Link
        to={`/conversations/${conversation.id}`}
        className="conversation-item"
      >
        <Avatar peer={conversation.peer} />
        <span className="conversation-main">
          <span className="conversation-peer">{name}</span>
          <span className="conversation-preview">
            {lastMessage ? lastMessage.preview : 'No messages yet'}
          </span>
        </span>
        <span className="conversation-meta">
          {lastMessage && (
            <span className="conversation-time">
              {formatConversationTimestamp(lastMessage.at)}
            </span>
          )}
          {hasUnread && (
            <span className="unread-badge" aria-label={`${unreadCount} unread`}>
              {unreadCount}
            </span>
          )}
        </span>
      </Link>
      <button
        type="button"
        className="conversation-hide"
        onClick={handleHide}
        disabled={hiding}
        aria-label={`Hide conversation with ${name}`}
        title="Hide"
      >
        {hiding ? '…' : '×'}
      </button>
    </div>
  );
}
