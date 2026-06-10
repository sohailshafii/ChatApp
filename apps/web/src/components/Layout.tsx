import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { NotificationPrompt } from '../notifications/NotificationPrompt';
import { ThemeToggle } from '../theme/ThemeToggle';

// App shell: a header band plus the routed page content. The header carries
// the account controls (username + log out, or a log in link) once auth resolves.
export function Layout() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <Link to="/" className="app-logo">
          ChatApp
        </Link>
        <nav className="app-nav" aria-label="Account">
          <ThemeToggle />
          {status === 'authenticated' && user && (
            <>
              <span className="app-user">{user.username}</span>
              <Link to="/settings">Settings</Link>
              <button type="button" className="btn-link" onClick={handleLogout}>
                Log out
              </button>
            </>
          )}
          {status === 'unauthenticated' && <Link to="/login">Log in</Link>}
        </nav>
      </header>
      <NotificationPrompt />
      <main id="main" className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
