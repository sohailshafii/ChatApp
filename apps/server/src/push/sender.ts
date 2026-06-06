import webpush from 'web-push';
import { loadConfig } from '../config.js';
import type { StoredSubscription } from './subscriptions.js';

// Thin wrapper over the `web-push` library (VAPID auth + payload encryption).
// `web-push` lands the message at the browser's push service; the service worker
// (apps/web) renders the notification.

let vapidSet = false;
function ensureVapid(): boolean {
  const c = loadConfig();
  if (!c.vapidConfigured) return false;
  if (!vapidSet) {
    webpush.setVapidDetails(c.vapidSubject, c.vapidPublicKey!, c.vapidPrivateKey!);
    vapidSet = true;
  }
  return true;
}

export function isPushConfigured(): boolean {
  return loadConfig().vapidConfigured;
}

// 'sent' on success, 'gone' when the push service reports the subscription is
// dead (404/410 — the caller prunes it), 'error' for anything else.
export type PushResult = 'sent' | 'gone' | 'error';

export type PushSender = (
  sub: StoredSubscription,
  payload: string,
) => Promise<PushResult>;

const realSender: PushSender = async (sub, payload) => {
  if (!ensureVapid()) return 'error';
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    );
    return 'sent';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'gone' : 'error';
  }
};

// Test seam: inject a fake sender (pass undefined to restore the real one).
let override: PushSender | undefined;
export function setPushSender(sender: PushSender | undefined): void {
  override = sender;
}
export function getPushSender(): PushSender {
  return override ?? realSender;
}
