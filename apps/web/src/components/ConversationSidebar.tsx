import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import type { ConversationSummary } from '@chatapp/shared';
import { hideConversation, listConversations } from '../api/conversations';
import { useChatSocket } from '../chat/ChatSocketProvider';
import {
  applyFrameToConversations,
  frameTargetsUnknownConversation,
} from '../chat/conversationListUpdate';
import { ConversationList } from './ConversationList';

// Left rail (Slack-style): the conversation list (§2) plus a compose button.
// Stays mounted across center-pane route changes, so opening a chat no longer
// unmounts/refetches the list — it's kept live from the WebSocket while shown.
type Status = 'loading' | 'error' | 'ready';

export function ConversationSidebar() {
  const { subscribe } = useChatSocket();
  const [status, setStatus] = useState<Status>('loading');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  // The currently open conversation, so we can highlight it and clear its badge.
  // `/conversations/:id` also matches `/conversations/new`, so exclude that.
  const match = useMatch('/conversations/:id');
  const activeId =
    match && match.params.id !== 'new' ? (match.params.id ?? null) : null;

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

  // Opening a conversation marks it read on the server (ConversationPage); clear
  // its unread badge here too so the rail reflects that immediately.
  useEffect(() => {
    if (!activeId) return;
    setConversations((prev) =>
      prev.some((c) => c.id === activeId && c.unreadCount > 0)
        ? prev.map((c) => (c.id === activeId ? { ...c, unreadCount: 0 } : c))
        : prev,
    );
  }, [activeId]);

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
    <nav className="conversation-sidebar" aria-label="Conversations">
      <div className="sidebar-head">
        <h2 id="chats-heading">Chats</h2>
        <Link
          to="/conversations/new"
          className="compose-btn"
          aria-label="New conversation"
          title="New conversation"
        >
          <span aria-hidden="true">+</span>
        </Link>
      </div>

      {status === 'loading' && (
        <p className="loading sidebar-note" role="status">
          Loading your conversations…
        </p>
      )}
      {status === 'error' && (
        <p className="form-error sidebar-note" role="alert">
          Couldn’t load your conversations. Please refresh to try again.
        </p>
      )}
      {status === 'ready' && (
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onHide={handleHide}
        />
      )}
    </nav>
  );
}
