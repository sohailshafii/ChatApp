import { useNotifications } from './NotificationsProvider';

// Settings control for OS notification permission (§5 permission flow). The
// browser only lets us prompt from 'default'; once granted or blocked, the user
// manages it in browser settings, so we just reflect the state.
export function NotificationsSettings() {
  const { supported, permission, requestPermission } = useNotifications();

  return (
    <section aria-labelledby="notifications-heading">
      <h2 id="notifications-heading">Notifications</h2>
      <p>
        Get notified about new messages when ChatApp isn’t the tab you’re looking
        at. In-app unread badges work whether or not you enable these.
      </p>

      {!supported ? (
        <p className="form-hint">This browser doesn’t support notifications.</p>
      ) : permission === 'granted' ? (
        <p className="form-success" role="status">
          Notifications are on. To turn them off, use your browser’s site settings.
        </p>
      ) : permission === 'denied' ? (
        <p className="form-hint">
          Notifications are blocked. To turn them on, allow notifications for this
          site in your browser settings.
        </p>
      ) : (
        <button
          type="button"
          className="btn-primary"
          onClick={() => void requestPermission()}
        >
          Enable notifications
        </button>
      )}
    </section>
  );
}
