import type {
  PushSubscriptionInput,
  VapidPublicKeyResponse,
} from '@chatapp/shared';
import { apiFetch } from './client';

// Web Push endpoints (§5 state D). These do not exist server-side yet — the
// subscribe flow is best-effort and degrades silently until they're wired.

/** GET /push/vapid-public-key — the applicationServerKey for subscribing. */
export async function getVapidPublicKey(): Promise<string> {
  const res = await apiFetch<VapidPublicKeyResponse>('/push/vapid-public-key');
  return res.publicKey;
}

/** POST /push/subscriptions — register this browser's push subscription. */
export async function savePushSubscription(
  subscription: PushSubscriptionInput,
): Promise<void> {
  await apiFetch<void>('/push/subscriptions', {
    method: 'POST',
    body: subscription,
  });
}

/** DELETE /push/subscriptions — remove this browser's subscription. */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  await apiFetch<void>('/push/subscriptions', {
    method: 'DELETE',
    body: { endpoint },
  });
}
