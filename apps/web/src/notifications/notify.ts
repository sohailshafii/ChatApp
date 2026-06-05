// Pure helpers for OS notifications (§5 state C). The provider does the actual
// `new Notification(...)`; these are the testable decisions around it.

const PREVIEW_MAX = 100;

// Body of a notification: a short preview of the message (§5 "first ~100
// characters"). Collapses whitespace/newlines so it reads on one line.
export function notificationPreview(content: string, max = PREVIEW_MAX): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

// Whether to fire an OS notification for an incoming message: only when the tab
// is hidden (state C — visible tabs already show the live view/badge) and the
// user has granted permission. Own messages (echoed from another tab) never
// notify; the caller filters those before calling.
export function shouldFireNotification(opts: {
  hidden: boolean;
  permission: NotificationPermission;
}): boolean {
  return opts.hidden && opts.permission === 'granted';
}
