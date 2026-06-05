import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ConversationSummary, Message } from '@chatapp/shared';
import { useAuth } from '../auth/AuthContext';
import {
  getConversation,
  getMessages,
  markConversationRead,
} from '../api/conversations';
import { MessageList } from '../components/MessageList';
import { peerName } from '../lib/peer';

const PAGE_SIZE = 50;

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; conversation: ConversationSummary };

// Conversation detail: peer header + message history (§3/§4). Live send/receive
// over the WebSocket is the next slice; this view loads history over REST and
// marks the conversation read.
export function ConversationPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    let active = true;
    setLoad({ status: 'loading' });
    setMessages([]);
    setNextBefore(null);

    Promise.all([getConversation(id), getMessages(id, { limit: PAGE_SIZE })])
      .then(([detail, page]) => {
        if (!active) return;
        setLoad({ status: 'ready', conversation: detail.conversation });
        setMessages(page.messages);
        setNextBefore(page.nextBefore);
        // Clear unread up to the newest loaded message (§7).
        const newest = page.messages[page.messages.length - 1];
        if (newest) void markConversationRead(id, newest.id).catch(() => {});
      })
      .catch(() => {
        if (active) setLoad({ status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [id]);

  const loadOlder = useCallback(async () => {
    if (!nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await getMessages(id, { before: nextBefore, limit: PAGE_SIZE });
      setMessages((prev) => [...page.messages, ...prev]);
      setNextBefore(page.nextBefore);
    } catch {
      // Leave the loaded history in place; the user can retry.
    } finally {
      setLoadingOlder(false);
    }
  }, [id, nextBefore, loadingOlder]);

  if (load.status === 'loading') {
    return (
      <section className="page conversation">
        <p className="loading" role="status">
          Loading conversation…
        </p>
      </section>
    );
  }
  if (load.status === 'error') {
    return (
      <section className="page conversation">
        <p className="form-error" role="alert">
          Couldn’t load this conversation.{' '}
          <Link to="/">Back to chats</Link>
        </p>
      </section>
    );
  }

  const name = peerName(load.conversation.peer);

  return (
    <section className="page conversation" aria-labelledby="conversation-heading">
      <header className="conversation-header">
        <Link to="/" className="back-link" aria-label="Back to chats">
          ←
        </Link>
        <h1 id="conversation-heading">{name}</h1>
      </header>

      {nextBefore && (
        <button
          type="button"
          className="btn-link load-older"
          onClick={loadOlder}
          disabled={loadingOlder}
        >
          {loadingOlder ? 'Loading…' : 'Load earlier messages'}
        </button>
      )}

      {messages.length === 0 ? (
        <p className="empty">No messages yet.</p>
      ) : (
        <MessageList messages={messages} ownId={user?.id ?? ''} peerLabel={name} />
      )}
    </section>
  );
}
