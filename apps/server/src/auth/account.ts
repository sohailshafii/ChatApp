import { getPool } from '../db/pool.js';

// Immediate hard delete of an account (§6). In one transaction:
//  1. hard-delete the account's bot conversations (their messages cascade) —
//     done first, while the participant row still identifies them;
//  2. delete the account row, which cascades the rest: sessions, *_tokens,
//     conversation_participants (human convos included), bot_usage. The audit
//     log's account_id is ON DELETE SET NULL, so the log outlives the account.
//
// The account's human-conversation MESSAGES are intentionally retained:
// messages.sender_id is plain text (no FK), so the peer's copy of the history
// stays intact. The peer's conversation then resolves to "Deleted user" (see
// resolvePeer in conversations/summaries.ts).
//
// Push subscriptions: there is no push_subscriptions table yet (upcoming §5
// server work); when it lands it should FK accounts ON DELETE CASCADE, and this
// account-row delete will remove them automatically.
export async function deleteAccount(accountId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM conversations c
         USING conversation_participants p
        WHERE p.conversation_id = c.id
          AND p.account_id = $1
          AND c.bot_id IS NOT NULL`,
      [accountId],
    );
    await client.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
