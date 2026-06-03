import { Link, Outlet } from 'react-router-dom';

// App shell: a header band plus the routed page content. Intentionally minimal
// for v1 — the conversation UI will grow inside this frame later.
export function Layout() {
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <Link to="/" className="app-logo">
          ChatApp
        </Link>
      </header>
      <main id="main" className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
