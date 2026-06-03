import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth, RedirectIfAuthed } from './auth/guards';
import { HomePage } from './pages/HomePage';
import { SignupPage } from './pages/SignupPage';
import { LoginPage } from './pages/LoginPage';
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

        {/* Public recovery flows (stubs for now). */}
        <Route
          path="verify-email/resend"
          element={<Placeholder title="Resend verification email" />}
        />
        <Route
          path="password-reset"
          element={<Placeholder title="Reset your password" />}
        />

        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Route>
    </Routes>
  );
}
