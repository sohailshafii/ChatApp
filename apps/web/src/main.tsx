import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ChatSocketProvider } from './chat/ChatSocketProvider';
import { NotificationsProvider } from './notifications/NotificationsProvider';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ChatSocketProvider>
          <NotificationsProvider>
            <App />
          </NotificationsProvider>
        </ChatSocketProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
