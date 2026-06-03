import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { SignupPage } from './pages/SignupPage';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="signup" element={<SignupPage />} />
        {/* Stubs for flows linked from signup but not yet built. */}
        <Route path="login" element={<Placeholder title="Log in" />} />
        <Route
          path="verify-email/resend"
          element={<Placeholder title="Resend verification email" />}
        />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Route>
    </Routes>
  );
}
