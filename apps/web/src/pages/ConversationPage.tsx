import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ConversationSummary } from '@chatapp/shared';
import { useAuth } from '../auth/AuthContext';
import { useChatSocket } from '../chat/ChatSocketProvider';
import { messageReducer } from '../chat/messageReducer';
import {
  getConversation,
  getMessages,
  hideConversation,
  markConversationRead,
} from '../api/conversations';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { Avatar } from '../components/Avatar';
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const { status: socketStatus, send, subscribe } = useChatSocket();

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [hiding, setHiding] = useState(false);
  const [messages, dispatch] = useReducer(messageReducer, []);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Whether the viewport is pinned to the latest message. The window is the
  // scroll container (the composer sits in normal flow at page bottom), so new
  // messages and streaming bot chunks grow the page below the fold. We follow
  // them only when the user is already near the bottom — scrolling up to read
  // history (or paging in older messages) shouldn't be interrupted.
  const stickToBottom = useRef(true);

  // Track whether the user is near the bottom as they scroll the window.
  useEffect(() => {
    function onScroll() {
      const doc = document.documentElement;
      const distanceFromBottom = doc.scrollHeight - (window.scrollY + window.innerHeight);
      stickToBottom.current = distanceFromBottom < 120;
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Switching conversations should open at the latest message.
  useEffect(() => {
    stickToBottom.current = true;
  }, [id]);

  // After messages render (initial load, send, incoming, streaming chunk),
  // follow to the bottom when pinned. useLayoutEffect avoids a visible jump.
  useLayoutEffect(() => {
    if (stickToBottom.current) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [messages]);

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

  async function handleHide() {
    if (hiding) return;
    if (!window.confirm('Hide this conversation? It will reappear if there is new activity.')) {
      return;
    }
    setHiding(true);
    try {
      await hideConversation(id);
      navigate('/', { replace: true });
    } catch {
      setHiding(false);
      window.alert('Couldn’t hide the conversation. Please try again.');
    }
  }

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
        <Avatar peer={load.conversation.peer} />
        <h1 id="conversation-heading">{name}</h1>
        <button
          type="button"
          className="btn-link hide-conversation"
          onClick={handleHide}
          disabled={hiding}
        >
          {hiding ? 'Hiding…' : 'Hide'}
        </button>
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
