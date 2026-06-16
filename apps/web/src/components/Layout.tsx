import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BetaNotice } from './BetaNotice';
import { NotificationPrompt } from '../notifications/NotificationPrompt';
import { ThemeToggle } from '../theme/ThemeToggle';

// App shell: a header band plus the routed page content. The header carries
// the account controls (username + log out, or a log in link) once auth resolves.
export function Layout() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Focus management for SPA navigation: on route change move focus to the main
  // landmark (so keyboard/SR users land on the new content instead of being
  // stranded on the old link) and announce the new view by its heading.
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const [routeAnnouncement, setRouteAnnouncement] = useState('');
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const main = mainRef.current;
    main?.focus({ preventScroll: true });
    const readHeading = () => main?.querySelector('h1')?.textContent?.trim() ?? '';

    // If the new view's heading is already mounted, announce it. Otherwise the
    // page is loading behind a skeleton (e.g. a conversation): watch for the
    // heading to appear and announce it then, falling back to the document
    // title if it never does.
    const initial = readHeading();
    if (initial || !main) {
      setRouteAnnouncement(initial || document.title);
      return;
    }
    let settled = false;
    const announce = (text: string) => {
      if (settled || !text) return;
      settled = true;
      setRouteAnnouncement(text);
    };
    const observer = new MutationObserver(() => announce(readHeading()));
    observer.observe(main, { childList: true, subtree: true });
    const timer = window.setTimeout(() => announce(document.title), 4000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [pathname]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <BetaNotice />
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
      <main id="main" className="app-main" tabIndex={-1} ref={mainRef}>
        <Outlet />
      </main>
      <div className="visually-hidden" aria-live="polite">
        {routeAnnouncement}
      </div>
    </div>
  );
}
