import { Link } from 'react-router-dom';

// Center-pane placeholder shown at `/` when no conversation is open (desktop).
export function ChatEmptyState() {
  return (
    <div className="chat-empty">
      <p className="chat-empty-emoji" aria-hidden="true">
        💬
      </p>
      <p className="chat-empty-title">No conversation selected</p>
      <p className="chat-empty-sub">
        Pick a chat from the list, or{' '}
        <Link to="/conversations/new">start a new one</Link>.
      </p>
    </div>
  );
}
