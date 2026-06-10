import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { MessagingLayout } from './components/MessagingLayout';
import { RequireAuth, RedirectIfAuthed } from './auth/guards';
import { ChatEmptyState } from './pages/ChatEmptyState';
import { SignupPage } from './pages/SignupPage';
import { LoginPage } from './pages/LoginPage';
import { ConversationPage } from './pages/ConversationPage';
import { NewConversationPage } from './pages/NewConversationPage';
import { SettingsPage } from './pages/SettingsPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { ResendVerificationPage } from './pages/ResendVerificationPage';
import { PasswordResetRequestPage } from './pages/PasswordResetRequestPage';
import { PasswordResetConfirmPage } from './pages/PasswordResetConfirmPage';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Requires a session. */}
        <Route element={<RequireAuth />}>
          {/* Two-pane messaging: persistent rail + active conversation. */}
          <Route element={<MessagingLayout />}>
            <Route index element={<ChatEmptyState />} />
            <Route path="conversations/new" element={<NewConversationPage />} />
            <Route path="conversations/:id" element={<ConversationPage />} />
          </Route>
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Guest-only: authenticated users are bounced home. */}
        <Route element={<RedirectIfAuthed />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
        </Route>

        {/* Public auth flows (reachable logged in or out). */}
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="verify-email/resend" element={<ResendVerificationPage />} />
        <Route path="password-reset" element={<PasswordResetRequestPage />} />
        <Route path="password-reset/confirm" element={<PasswordResetConfirmPage />} />

        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Route>
    </Routes>
  );
}
