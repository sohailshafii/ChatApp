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
import { ConversationSkeleton } from '../components/Skeletons';
import { EmptyState } from '../components/EmptyState';
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

  // Whether the message pane is pinned to the latest message. The pane scrolls
  // internally (header and composer stay put), so new messages and streaming
  // bot chunks grow it below the fold. We follow them only when the user is
  // already near the bottom — scrolling up to read history (or paging in older
  // messages) shouldn't be interrupted.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Show a "jump to latest" affordance when scrolled up; flag when something new
  // arrived below the fold so the pill reads "New messages".
  const [showJump, setShowJump] = useState(false);
  const [hasNew, setHasNew] = useState(false);

  // Politely announce incoming peer/bot messages to assistive tech (the visual
  // thread isn't a live region, so screen-reader users wouldn't hear new ones).
  const [announcement, setAnnouncement] = useState('');
  const loadRef = useRef(load);
  loadRef.current = load;

  // Track whether the user is near the bottom as they scroll the message pane.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickToBottom.current = nearBottom;
    setShowJump(!nearBottom);
    if (nearBottom) setHasNew(false);
  }, []);

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickToBottom.current = true;
    setShowJump(false);
    setHasNew(false);
  }, []);

  // Switching conversations should open at the latest message.
  useEffect(() => {
    stickToBottom.current = true;
    setShowJump(false);
    setHasNew(false);
  }, [id]);

  // After messages render (initial load, send, incoming, streaming chunk),
  // follow to the bottom when pinned. useLayoutEffect avoids a visible jump.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
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
    const announce = (content: string) => {
      const cur = loadRef.current;
      const who = cur.status === 'ready' ? peerName(cur.conversation.peer) : 'New message';
      setAnnouncement(`${who} said: ${content}`);
    };
    return subscribe((frame) => {
      dispatch({ type: 'frame', conversationId: id, frame });
      // Keep the read cursor current — and announce — for messages that arrive
      // while viewing. Skip our own echoes; announce the bot reply once complete.
      if (frame.type === 'message' && frame.message.conversationId === id) {
        void markConversationRead(id, frame.message.id).catch(() => {});
        if (frame.message.senderId !== user?.id) {
          announce(frame.message.content);
          if (!stickToBottom.current) setHasNew(true);
        }
      } else if (frame.type === 'bot_end' && frame.message.conversationId === id) {
        void markConversationRead(id, frame.message.id).catch(() => {});
        announce(frame.message.content);
        if (!stickToBottom.current) setHasNew(true);
      }
    });
  }, [id, subscribe, user?.id]);

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
      <section className="chat">
        <ConversationSkeleton />
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
  const isBot = load.conversation.peer.kind === 'bot';

  return (
    <section className="chat" aria-labelledby="conversation-heading">
      <header className="chat-header">
        <Link to="/" className="back-link" aria-label="Back to chats">
          ←
        </Link>
        <Avatar peer={load.conversation.peer} />
        <div className="chat-title">
          <h1 id="conversation-heading">
            {name}
            {isBot && <span className="bot-tag"> (bot)</span>}
          </h1>
          {isBot && (
            <p className="bot-disclaimer">
              This is a bot powered by a large language model. It is not a real
              person and shouldn’t be treated as one.
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn-link hide-conversation"
          onClick={handleHide}
          disabled={hiding}
        >
          {hiding ? 'Hiding…' : 'Hide'}
        </button>
      </header>

      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>

      {socketStatus !== 'open' && (
        <p className="socket-status" role="status">
          Reconnecting…
        </p>
      )}

      <div className="chat-body">
        <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
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
            <EmptyState emoji="👋" title="No messages yet" fill>
              Say hello to start the conversation.
            </EmptyState>
          ) : (
            <MessageList messages={messages} ownId={user?.id ?? ''} peerLabel={name} />
          )}
        </div>

        {showJump && (
          <button
            type="button"
            className="scroll-bottom-btn"
            onClick={jumpToBottom}
            aria-label="Scroll to latest messages"
          >
            <span aria-hidden="true">↓</span>
            {hasNew ? ' New messages' : ' Latest'}
          </button>
        )}
      </div>

      <Composer onSend={handleSend} disabled={socketStatus !== 'open'} />
    </section>
  );
}
