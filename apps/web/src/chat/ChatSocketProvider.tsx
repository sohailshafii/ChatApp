import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ClientWsMessage, ServerWsMessage } from '@chatapp/shared';
import { useAuth } from '../auth/AuthContext';
import { ChatSocket, type SocketStatus } from './ChatSocket';

// Owns the single app-wide ChatSocket, opening it only while authenticated and
// closing it on logout. Exposes status + send + subscribe to the tree.
interface ChatSocketValue {
  status: SocketStatus;
  send: (frame: ClientWsMessage) => boolean;
  subscribe: (listener: (frame: ServerWsMessage) => void) => () => void;
}

const ChatSocketContext = createContext<ChatSocketValue | null>(null);

export function ChatSocketProvider({ children }: { children: ReactNode }) {
  const { status: authStatus } = useAuth();
  const socketRef = useRef<ChatSocket | null>(null);
  if (socketRef.current === null) socketRef.current = new ChatSocket();
  const socket = socketRef.current;

  const [status, setStatus] = useState<SocketStatus>('closed');

  useEffect(() => socket.onStatus(setStatus), [socket]);

  useEffect(() => {
    if (authStatus === 'authenticated') socket.start();
    else socket.stop();
  }, [authStatus, socket]);

  const value = useMemo<ChatSocketValue>(
    () => ({
      status,
      send: (frame) => socket.send(frame),
      subscribe: (listener) => socket.subscribe(listener),
    }),
    [status, socket],
  );

  return (
    <ChatSocketContext.Provider value={value}>
      {children}
    </ChatSocketContext.Provider>
  );
}

export function useChatSocket(): ChatSocketValue {
  const ctx = useContext(ChatSocketContext);
  if (!ctx) throw new Error('useChatSocket must be used within a ChatSocketProvider');
  return ctx;
}
