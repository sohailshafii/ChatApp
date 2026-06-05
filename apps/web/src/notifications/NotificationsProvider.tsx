import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useChatSocket } from '../chat/ChatSocketProvider';
import { listConversations } from '../api/conversations';
import { peerName } from '../lib/peer';
import { documentTitle, unreadReducer, unreadTotal } from './unread';
import { notificationPreview, shouldFireNotification } from './notify';
import { setFaviconBadge } from './favicon';

// App-level notification layer (§5, state C). Keeps a running unread total fed
// by the WebSocket and drives the tab title + favicon dot; when the tab is
// hidden and the user has granted permission, fires an OS notification for
// incoming messages. State D (Web Push via a service worker) builds on the
// permission primitive exposed here.

const SUPPORTED = typeof window !== 'undefined' && 'Notification' in window;

interface NotificationsValue {
  supported: boolean;
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

function openConversationId(pathname: string): string | null {
  const m = pathname.match(/^\/conversations\/([^/]+)$/);
  return m && m[1] !== 'new' ? m[1]! : null;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useAuth();
  const { subscribe } = useChatSocket();
  const navigate = useNavigate();
  const location = useLocation();

  const [permission, setPermission] = useState<NotificationPermission>(
    SUPPORTED ? Notification.permission : 'denied',
  );
  const [unread, dispatch] = useReducer(unreadReducer, {});
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );

  // Latest values for the socket handler, which is wired once per session and
  // must not re-subscribe on every state change.
  const namesRef = useRef<Record<string, string>>({});
  const ownIdRef = useRef<string | undefined>(user?.id);
  ownIdRef.current = user?.id;
  const permissionRef = useRef(permission);
  permissionRef.current = permission;
  const openIdRef = useRef<string | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const openId = openConversationId(location.pathname);
  openIdRef.current = openId;

  // Track tab visibility (state C only fires when hidden).
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Seed the unread baseline + peer-name lookup from REST on login; clear on logout.
  useEffect(() => {
    if (authStatus !== 'authenticated') {
      dispatch({ type: 'reset' });
      namesRef.current = {};
      return;
    }
    let active = true;
    listConversations()
      .then((res) => {
        if (!active) return;
        dispatch({ type: 'seed', conversations: res.conversations });
        const names: Record<string, string> = {};
        for (const c of res.conversations) names[c.id] = peerName(c.peer);
        namesRef.current = names;
      })
      .catch(() => {
        // Best-effort: a failed seed just means the title starts at zero.
      });
    return () => {
      active = false;
    };
  }, [authStatus]);

  // Viewing a conversation (and visible) clears its unread, mirroring the
  // server's mark-read-on-open.
  useEffect(() => {
    if (openId && visible) dispatch({ type: 'read', conversationId: openId });
  }, [openId, visible]);

  const fireNotification = useCallback(
    (conversationId: string, content: string) => {
      try {
        const n = new Notification(namesRef.current[conversationId] ?? 'New message', {
          body: notificationPreview(content),
          tag: conversationId,
        });
        n.onclick = () => {
          window.focus();
          navigate(`/conversations/${conversationId}`);
          n.close();
        };
      } catch {
        // Notification construction can throw on some platforms; ignore.
      }
    },
    [navigate],
  );

  // Live updates: count incoming messages and (when hidden + permitted) notify.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    return subscribe((frame) => {
      let conversationId: string;
      let content: string;
      if (frame.type === 'message') {
        if (frame.message.senderId === ownIdRef.current) return; // our own echo
        conversationId = frame.message.conversationId;
        content = frame.message.content;
      } else if (frame.type === 'bot_end') {
        conversationId = frame.message.conversationId;
        content = frame.message.content;
      } else {
        return;
      }

      const focused = conversationId === openIdRef.current && visibleRef.current;
      if (focused) {
        dispatch({ type: 'read', conversationId });
        return;
      }
      dispatch({ type: 'incoming', conversationId });
      if (shouldFireNotification({ hidden: document.hidden, permission: permissionRef.current })) {
        fireNotification(conversationId, content);
      }
    });
  }, [authStatus, subscribe, fireNotification]);

  // Reflect the unread total into the tab title + favicon.
  const total = unreadTotal(unread);
  useEffect(() => {
    document.title = documentTitle(total);
    setFaviconBadge(total > 0);
  }, [total]);

  const requestPermission = useCallback(async () => {
    if (!SUPPORTED) return 'denied' as NotificationPermission;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const value = useMemo<NotificationsValue>(
    () => ({ supported: SUPPORTED, permission, requestPermission }),
    [permission, requestPermission],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within a NotificationsProvider');
  return ctx;
}
