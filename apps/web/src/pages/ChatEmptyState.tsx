import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';

// Center-pane placeholder shown at `/` when no conversation is open (desktop).
export function ChatEmptyState() {
  return (
    <EmptyState emoji="💬" title="No conversation selected" fill>
      Pick a chat from the list, or{' '}
      <Link to="/conversations/new">start a new one</Link>.
    </EmptyState>
  );
}
