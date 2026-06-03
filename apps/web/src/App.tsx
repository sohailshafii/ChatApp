import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth, RedirectIfAuthed } from './auth/guards';
import { HomePage } from './pages/HomePage';
import { SignupPage } from './pages/SignupPage';
import { LoginPage } from './pages/LoginPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { ResendVerificationPage } from './pages/ResendVerificationPage';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Requires a session. */}
        <Route element={<RequireAuth />}>
          <Route index element={<HomePage />} />
        </Route>

        {/* Guest-only: authenticated users are bounced home. */}
        <Route element={<RedirectIfAuthed />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
        </Route>

        {/* Public auth flows (reachable logged in or out). */}
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="verify-email/resend" element={<ResendVerificationPage />} />
        <Route
          path="password-reset"
          element={<Placeholder title="Reset your password" />}
        />

        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Route>
    </Routes>
  );
}
