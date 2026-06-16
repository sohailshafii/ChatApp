import { useState } from 'react';
import { reportAbuseMailto } from '../lib/support';

const DISMISS_KEY = 'chatapp-beta-dismissed';

function initiallyDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Private mode / storage disabled: just show the notice.
    return false;
  }
}

// A dismissible banner shown at the top of the app shell on the public test
// deployment. It sets expectations (test data, no E2E) and the acceptable-use
// rules, and surfaces the abuse-report channel. Dismissal is remembered per
// browser; the permanent report link also lives in Settings.
export function BetaNotice() {
  const [dismissed, setDismissed] = useState(initiallyDismissed);

  if (dismissed) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Ignore storage failures; dismissing for this session is enough.
    }
    setDismissed(true);
  }

  return (
    <aside className="beta-notice" aria-label="Test deployment notice">
      <p className="beta-notice-text">
        This is a public <strong>test deployment</strong> — please don’t share
        sensitive information, and note that messages may be reset at any time. Be
        respectful: harassment, illegal content, and spam are not allowed and may
        get accounts suspended.{' '}
        <a href={reportAbuseMailto}>Report abuse</a>.
      </p>
      <button
        type="button"
        className="beta-notice-dismiss"
        onClick={dismiss}
        aria-label="Dismiss test deployment notice"
      >
        ✕
      </button>
    </aside>
  );
}
