import { Link } from 'react-router-dom';

// Temporary stand-in for routes not yet implemented, so navigation links from
// the signup flow don't dead-end during development.
export function Placeholder({ title }: { title: string }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p>This page isn’t built yet.</p>
      <p>
        <Link to="/">Back home</Link>
      </p>
    </section>
  );
}
