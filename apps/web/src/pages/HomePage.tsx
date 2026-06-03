import { Link } from 'react-router-dom';

// Placeholder landing view. The authenticated conversation list (REQUIREMENTS.md §2)
// will replace this once auth + data fetching land.
export function HomePage() {
  return (
    <section className="page">
      <h1>Welcome to ChatApp</h1>
      <p>A simple, fast place to chat.</p>
      <p>
        <Link to="/signup">Create an account</Link> or{' '}
        <Link to="/login">log in</Link>.
      </p>
    </section>
  );
}
