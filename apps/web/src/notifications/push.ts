import {
  deletePushSubscription,
  getVapidPublicKey,
  savePushSubscription,
} from '../api/push';

// Web Push subscription plumbing (§5 state D). Best-effort throughout: if the
// browser lacks support or the server push endpoints aren't wired yet, these
// resolve to a no-op rather than throwing, so notifications (state C) keep
// working regardless.

// VAPID keys arrive base64url-encoded; PushManager wants a Uint8Array.
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

// Ensure this browser has a push subscription registered server-side. Reuses an
// existing subscription if present, else subscribes with the server's VAPID
// key. Idempotent and safe to call repeatedly. Returns false on any failure
// (e.g. the server endpoints don't exist yet).
export async function ensurePushSubscription(
  registration: ServiceWorkerRegistration,
): Promise<boolean> {
  try {
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const key = await getVapidPublicKey();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: the generic Uint8Array type doesn't structurally match
        // BufferSource in current lib.dom, but it's a valid value at runtime.
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
    }
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    await savePushSubscription({
      endpoint: json.endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return true;
  } catch {
    return false;
  }
}

// Tear down this browser's subscription (on logout). Best-effort.
export async function removePushSubscription(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await deletePushSubscription(subscription.endpoint);
    await subscription.unsubscribe();
  } catch {
    // Ignore — the server prunes dead subscriptions when a push fails.
  }
}
