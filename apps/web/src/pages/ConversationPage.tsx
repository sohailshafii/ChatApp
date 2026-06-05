import { useCallback, useEffect, useReducer, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ConversationSummary } from '@chatapp/shared';
import { useAuth } from '../auth/AuthContext';
import { useChatSocket } from '../chat/ChatSocketProvider';
import { messageReducer } from '../chat/messageReducer';
import {
  getConversation,
  getMessages,
  markConversationRead,
} from '../api/conversations';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { peerName } from '../lib/peer';

const PAGE_SIZE = 50;

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; conversation: ConversationSummary };

// Conversation detail with live messaging (§3): REST history + a WebSocket for
// send/receive. Sends are optimistic; the reducer reconciles ack/delivery and
// streams bot replies.
export function ConversationPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { status: socketStatus, send, subscribe } = useChatSocket();

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [messages, dispatch] = useReducer(messageReducer, []);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Load metadata + the latest history page, and mark read.
  useEffect(() => {
    let active = true;
    setLoad({ status: 'loading' });
    setNextBefore(null);

    Promise.all([getConversation(id), getMessages(id, { limit: PAGE_SIZE })])
      .then(([detail, page]) => {
        if (!active) return;
        setLoad({ status: 'ready', conversation: detail.conversation });
        dispatch({ type: 'reset', messages: page.messages });
        setNextBefore(page.nextBefore);
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

  // Live frames for this conversation.
  useEffect(() => {
    return subscribe((frame) => {
      dispatch({ type: 'frame', conversationId: id, frame });
      // Keep the read cursor current for messages that arrive while viewing.
      if (frame.type === 'message' && frame.message.conversationId === id) {
        void markConversationRead(id, frame.message.id).catch(() => {});
      } else if (frame.type === 'bot_end' && frame.message.conversationId === id) {
        void markConversationRead(id, frame.message.id).catch(() => {});
      }
    });
  }, [id, subscribe]);

  const loadOlder = useCallback(async () => {
    if (!nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await getMessages(id, { before: nextBefore, limit: PAGE_SIZE });
      dispatch({ type: 'prepend', messages: page.messages });
      setNextBefore(page.nextBefore);
    } catch {
      // Leave loaded history in place; the user can retry.
    } finally {
      setLoadingOlder(false);
    }
  }, [id, nextBefore, loadingOlder]);

  const handleSend = useCallback(
    (content: string) => {
      const clientMessageId = crypto.randomUUID();
      dispatch({
        type: 'pending',
        draft: {
          clientMessageId,
          senderId: user?.id ?? '',
          content,
          createdAt: new Date().toISOString(),
        },
      });
      const ok = send({ type: 'send', conversationId: id, clientMessageId, content });
      if (!ok) {
        dispatch({
          type: 'frame',
          conversationId: id,
          frame: {
            type: 'error',
            code: 'internal_error',
            message: 'Not connected',
            clientMessageId,
          },
        });
      }
    },
    [id, send, user?.id],
  );

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
          Couldn’t load this conversation. <Link to="/">Back to chats</Link>
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

      {socketStatus !== 'open' && (
        <p className="socket-status" role="status">
          Reconnecting…
        </p>
      )}

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
        <p className="empty">No messages yet. Say hello.</p>
      ) : (
        <MessageList messages={messages} ownId={user?.id ?? ''} peerLabel={name} />
      )}

      <Composer onSend={handleSend} disabled={socketStatus !== 'open'} />
    </section>
  );
}
