import { useNotifications } from './NotificationsProvider';

// Contextual "get notified when offline" prompt (§5 permission flow). Rendered
// in the app shell; the provider only flags it visible after the user's first
// send/receive, so it never interrupts on load. Declining is fine — in-app
// badges, tab title, and favicon work without permission.
export function NotificationPrompt() {
  const { promptVisible, requestPermission, dismissPrompt } = useNotifications();

  if (!promptVisible) return null;

  async function enable() {
    await requestPermission();
    // Whatever the choice, the prompt stops showing (permission leaves 'default').
  }

  return (
    <div className="notif-prompt" role="region" aria-label="Notifications">
      <p className="notif-prompt-text">
        Get notified about new messages when ChatApp is closed or in the
        background?
      </p>
      <div className="notif-prompt-actions">
        <button type="button" className="btn-primary" onClick={() => void enable()}>
          Enable notifications
        </button>
        <button type="button" className="btn-link" onClick={dismissPrompt}>
          Not now
        </button>
      </div>
    </div>
  );
}
