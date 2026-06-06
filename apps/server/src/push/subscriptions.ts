import type { PushSubscriptionInput } from '@chatapp/shared';
import { query } from '../db/pool.js';

// Persistence for §5 Web Push subscriptions (table push_subscriptions, migration
// 010). A subscription endpoint is globally unique, so register is idempotent on
// it: re-registering refreshes the keys and (if the same browser switched users)
// moves it to the current account.

export type StoredSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function upsertSubscription(
  accountId: string,
  sub: PushSubscriptionInput,
): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (endpoint, account_id, p256dh, auth, expiration_time)
       VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET account_id      = EXCLUDED.account_id,
           p256dh          = EXCLUDED.p256dh,
           auth            = EXCLUDED.auth,
           expiration_time = EXCLUDED.expiration_time`,
    [sub.endpoint, accountId, sub.keys.p256dh, sub.keys.auth, sub.expirationTime ?? null],
  );
}

// Removes one of the caller's own subscriptions (scoped by account so a user
// can't delete another's). Idempotent.
export async function deleteSubscription(
  accountId: string,
  endpoint: string,
): Promise<void> {
  await query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND account_id = $2',
    [endpoint, accountId],
  );
}

export async function listSubscriptions(
  accountId: string,
): Promise<StoredSubscription[]> {
  const { rows } = await query<StoredSubscription>(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = $1',
    [accountId],
  );
  return rows;
}

// Prunes a dead subscription (the push service returned 404/410 Gone).
export async function deleteByEndpoint(endpoint: string): Promise<void> {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}
