import { Link } from 'react-router-dom';
import type { ConversationPeer, ConversationSummary } from '@chatapp/shared';
import { formatConversationTimestamp } from '../lib/time';

function peerName(peer: ConversationPeer): string {
  return peer.kind === 'human' ? peer.username : peer.name;
}

export function ConversationList({
  conversations,
}: {
  conversations: ConversationSummary[];
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
          <ConversationRow conversation={c} />
        </li>
      ))}
    </ul>
  );
}

function ConversationRow({ conversation }: { conversation: ConversationSummary }) {
  const name = peerName(conversation.peer);
  const { lastMessage, unreadCount } = conversation;
  const hasUnread = unreadCount > 0;

  return (
    <Link
      to={`/conversations/${conversation.id}`}
      className={`conversation-item${hasUnread ? ' is-unread' : ''}`}
    >
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
  );
}
