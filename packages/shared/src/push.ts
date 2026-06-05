import { z } from 'zod';

// Wire types for §5 state D (Web Push). Endpoint paths are documented inline;
// the canonical list lives in the server's route module. All require a session.

// GET /push/vapid-public-key — the server's VAPID public key (base64url),
// used as the `applicationServerKey` when subscribing. No body. It's a public
// key, so no CSRF needed; a session is still required (only signed-in users
// register for push).
export const vapidPublicKeyResponseSchema = z.object({
  publicKey: z.string().min(1),
});
export type VapidPublicKeyResponse = z.infer<typeof vapidPublicKeyResponseSchema>;

// A browser PushSubscription as serialized by `PushSubscription.toJSON()`.
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

// POST /push/subscriptions — register this browser/device's subscription for
// the authed user. Idempotent on `endpoint` (re-registering refreshes it).
// Body = pushSubscriptionSchema; responds 200 with an empty body.
//
// DELETE /push/subscriptions — remove a subscription when the user unsubscribes
// or logs out (§6 audit: "push subscription creation/removal"). Body:
export const deletePushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
});
export type DeletePushSubscriptionRequest = z.infer<
  typeof deletePushSubscriptionSchema
>;

// The JSON payload the server's push dispatcher sends; the service worker reads
// these fields to render the notification and route the click. Mirrors the
// in-tab notification: title = sender/bot name, body = ~100-char preview.
export const pushPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  conversationId: z.string().uuid(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;
