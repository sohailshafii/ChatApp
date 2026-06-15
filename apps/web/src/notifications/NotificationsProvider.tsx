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
import {
  ensurePushSubscription,
  registerServiceWorker,
  removePushSubscription,
} from './push';
import { playIncomingChime } from './sound';

// App-level notification layer (§5, state C). Keeps a running unread total fed
// by the WebSocket and drives the tab title + favicon dot; when the tab is
// hidden and the user has granted permission, fires an OS notification for
// incoming messages. State D (Web Push via a service worker) builds on the
// permission primitive exposed here.

const SUPPORTED = typeof window !== 'undefined' && 'Notification' in window;
const PROMPT_DISMISSED_KEY = 'chatapp:notif-prompt-dismissed';

interface NotificationsValue {
  supported: boolean;
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  // Contextual "get notified when offline" prompt (§5): shown only after the
  // user's first send/receive, while permission is still undecided and the
  // prompt hasn't been dismissed.
  promptVisible: boolean;
  dismissPrompt: () => void;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

function readPromptDismissed(): boolean {
  try {
    return localStorage.getItem(PROMPT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

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
  // The contextual prompt waits for the first send/receive (per spec, never on
  // load); dismissal persists so we don't nag across sessions.
  const [hasInteracted, setHasInteracted] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(readPromptDismissed);

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
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);

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

  // Tell the service worker which conversation is focused, so a Web Push for the
  // chat you're actively reading is suppressed (state D). The SW's URL check can
  // lag in-app navigation, so this postMessage is the authoritative signal.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const conversationId = visible ? openId : null;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => {
        if (!cancelled) reg.active?.postMessage({ type: 'focus-state', conversationId });
      })
      .catch(() => {
        // No active worker yet (push not set up) — nothing to inform.
      });
    return () => {
      cancelled = true;
    };
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
      // The first send (our own message acked) or receive unlocks the
      // contextual permission prompt.
      if (frame.type === 'ack' || frame.type === 'message' || frame.type === 'bot_end') {
        setHasInteracted(true);
      }

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
      // A subtle chime for an incoming message you're not actively reading
      // (state B/C; default-on).
      playIncomingChime();
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

  // Web Push (state D): once permission is granted, register the service worker
  // and ensure this browser is subscribed server-side. Best-effort — degrades
  // to nothing if unsupported or the push endpoints aren't wired yet.
  useEffect(() => {
    if (permission !== 'granted') return;
    let cancelled = false;
    registerServiceWorker().then((reg) => {
      if (cancelled || !reg) return;
      swRegRef.current = reg;
      void ensurePushSubscription(reg);
    });
    return () => {
      cancelled = true;
    };
  }, [permission]);

  // Drop this browser's push subscription on logout (§6 audit: removal).
  useEffect(() => {
    if (authStatus === 'unauthenticated' && swRegRef.current) {
      void removePushSubscription(swRegRef.current);
    }
  }, [authStatus]);

  const requestPermission = useCallback(async () => {
    if (!SUPPORTED) return 'denied' as NotificationPermission;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const dismissPrompt = useCallback(() => {
    setPromptDismissed(true);
    try {
      localStorage.setItem(PROMPT_DISMISSED_KEY, '1');
    } catch {
      // Storage unavailable — the prompt just won't stay dismissed across sessions.
    }
  }, []);

  const promptVisible =
    SUPPORTED &&
    authStatus === 'authenticated' &&
    permission === 'default' &&
    hasInteracted &&
    !promptDismissed;

  const value = useMemo<NotificationsValue>(
    () => ({
      supported: SUPPORTED,
      permission,
      requestPermission,
      promptVisible,
      dismissPrompt,
    }),
    [permission, requestPermission, promptVisible, dismissPrompt],
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
