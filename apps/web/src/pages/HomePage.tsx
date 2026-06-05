import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConversationSummary } from '@chatapp/shared';
import { hideConversation, listConversations } from '../api/conversations';
import { useChatSocket } from '../chat/ChatSocketProvider';
import { applyFrameToConversations } from '../chat/conversationListUpdate';
import { ConversationList } from '../components/ConversationList';

// Authenticated home: the conversation list (§2). Loaded over REST, then kept
// live from the WebSocket while on screen — new messages refresh the preview,
// bump the conversation up, and raise its unread count without a reload.
type Status = 'loading' | 'error' | 'ready';

export function HomePage() {
  const { subscribe } = useChatSocket();
  const [status, setStatus] = useState<Status>('loading');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    let active = true;
    listConversations()
      .then((res) => {
        if (!active) return;
        setConversations(res.conversations);
        setStatus('ready');
      })
      .catch(() => active && setStatus('error'));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return subscribe((frame) => {
      setConversations((prev) => applyFrameToConversations(prev, frame));
    });
  }, [subscribe]);

  // Hide a conversation from the list (§2). Drop it optimistically; if the
  // request fails, restore the prior list and let the row reset. New activity
  // (over the socket) un-hides it server-side, so it returns on its own.
  const handleHide = useCallback(async (id: string) => {
    let snapshot: ConversationSummary[] = [];
    setConversations((prev) => {
      snapshot = prev;
      return prev.filter((c) => c.id !== id);
    });
    try {
      await hideConversation(id);
    } catch (err) {
      setConversations(snapshot);
      window.alert('Couldn’t hide the conversation. Please try again.');
      throw err;
    }
  }, []);

  return (
    <section className="page" aria-labelledby="chats-heading">
      <div className="page-head">
        <h1 id="chats-heading">Chats</h1>
        <Link to="/conversations/new" className="btn-primary">
          New
        </Link>
      </div>

      {status === 'loading' && (
        <p className="loading" role="status">
          Loading your conversations…
        </p>
      )}
      {status === 'error' && (
        <p className="form-error" role="alert">
          Couldn’t load your conversations. Please refresh to try again.
        </p>
      )}
      {status === 'ready' && (
        <ConversationList conversations={conversations} onHide={handleHide} />
      )}
    </section>
  );
}
