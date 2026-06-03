import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { SignupPage } from './pages/SignupPage';
import { LoginPage } from './pages/LoginPage';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="login" element={<LoginPage />} />
        {/* Stubs for flows linked from signup/login but not yet built. */}
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
