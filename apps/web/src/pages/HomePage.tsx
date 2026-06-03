import { useAuth } from '../auth/AuthContext';

// Authenticated home. Placeholder for the conversation list (REQUIREMENTS.md §2),
// which will replace this once conversation data fetching lands. Reached only
// behind RequireAuth, so `user` is present.
export function HomePage() {
  const { user } = useAuth();
  return (
    <section className="page">
      <h1>Welcome{user ? `, ${user.username}` : ''}</h1>
      <p>Your conversations will appear here.</p>
    </section>
  );
}
