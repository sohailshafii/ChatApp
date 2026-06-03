import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

function Loading() {
  return (
    <p className="loading" role="status">
      Loading…
    </p>
  );
}

/**
 * Gate for routes that require a session. While auth is resolving we render a
 * placeholder (never redirect before we know the answer). Unauthenticated
 * users are sent to /login with the attempted path so login can return them.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Loading />;
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Gate for guest-only routes (login, signup): bounce authenticated users home. */
export function RedirectIfAuthed() {
  const { status } = useAuth();

  if (status === 'loading') return <Loading />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}
