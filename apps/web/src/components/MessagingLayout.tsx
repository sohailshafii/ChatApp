import { Outlet, useLocation } from 'react-router-dom';
import { ConversationSidebar } from './ConversationSidebar';

// Two-pane messaging shell (Slack-style): a persistent conversation rail on the
// left and the active conversation in the center. On narrow screens the panes
// collapse to one — the rail at `/`, the chat once one is open — driven by the
// `has-active-chat` class (the chat's own header carries a back arrow).
export function MessagingLayout() {
  const onChat = useLocation().pathname.startsWith('/conversations');
  return (
    <div className={`messaging-layout${onChat ? ' has-active-chat' : ''}`}>
      <ConversationSidebar />
      <div className="chat-pane">
        <Outlet />
      </div>
    </div>
  );
}
