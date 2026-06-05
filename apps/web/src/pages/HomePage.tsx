import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConversationSummary } from '@chatapp/shared';
import { listConversations } from '../api/conversations';
import { ConversationList } from '../components/ConversationList';

// Authenticated home: the conversation list (REQUIREMENTS.md §2). Reached only
// behind RequireAuth. Initial state is fetched over REST; live updates will
// arrive over the WebSocket in a later slice (§3).
type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; conversations: ConversationSummary[] };

export function HomePage() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    listConversations()
      .then((res) => {
        if (active) setState({ status: 'ready', conversations: res.conversations });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="page" aria-labelledby="chats-heading">
      <div className="page-head">
        <h1 id="chats-heading">Chats</h1>
        <Link to="/conversations/new" className="btn-primary">
          New
        </Link>
      </div>

      {state.status === 'loading' && (
        <p className="loading" role="status">
          Loading your conversations…
        </p>
      )}
      {state.status === 'error' && (
        <p className="form-error" role="alert">
          Couldn’t load your conversations. Please refresh to try again.
        </p>
      )}
      {state.status === 'ready' && (
        <ConversationList conversations={state.conversations} />
      )}
    </section>
  );
}
