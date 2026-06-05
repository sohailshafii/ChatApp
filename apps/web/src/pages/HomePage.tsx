import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConversationSummary } from '@chatapp/shared';
import { hideConversation, listConversations } from '../api/conversations';
import { useChatSocket } from '../chat/ChatSocketProvider';
import {
  applyFrameToConversations,
  frameTargetsUnknownConversation,
} from '../chat/conversationListUpdate';
import { ConversationList } from '../components/ConversationList';

// Authenticated home: the conversation list (§2). Loaded over REST, then kept
// live from the WebSocket while on screen — new messages refresh the preview,
// bump the conversation up, and raise its unread count without a reload.
type Status = 'loading' | 'error' | 'ready';

export function HomePage() {
  const { subscribe } = useChatSocket();
  const [status, setStatus] = useState<Status>('loading');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  // Latest list, for the socket handler to check membership without re-subscribing.
  const listRef = useRef<ConversationSummary[]>(conversations);
  listRef.current = conversations;

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

  // Refetch the whole list (the server is the source of truth) when a live frame
  // arrives for a conversation we can't render from the frame alone. Guarded so
  // concurrent unknown frames don't fan out into parallel requests; if more land
  // while a fetch is in flight, run exactly one more pass afterward.
  const refetchingRef = useRef(false);
  const pendingRef = useRef(false);
  const refetchList = useCallback(async () => {
    if (refetchingRef.current) {
      pendingRef.current = true;
      return;
    }
    refetchingRef.current = true;
    try {
      do {
        pendingRef.current = false;
        const res = await listConversations();
        setConversations(res.conversations);
      } while (pendingRef.current);
    } catch {
      // Leave the current list as-is; a later frame or remount will refetch.
    } finally {
      refetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    return subscribe((frame) => {
      if (frameTargetsUnknownConversation(listRef.current, frame)) {
        void refetchList();
        return;
      }
      setConversations((prev) => applyFrameToConversations(prev, frame));
    });
  }, [subscribe, refetchList]);

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
