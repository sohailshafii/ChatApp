-- 005_messages: §3 messages and the §7 per-participant last-seen cursor.

CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- Sender is a human account id or a bot slug; text holds both (§3).
  sender_id         text NOT NULL,
  content           text NOT NULL,
  -- Client-generated id for idempotent send / optimistic dedupe (§3); null for bots.
  client_message_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Ordering + backward history pagination within a conversation, by server
-- timestamp with id as the deterministic tiebreaker (§3/§4).
CREATE INDEX messages_conversation_created_idx
  ON messages (conversation_id, created_at, id);

-- Idempotent send: a sender retrying the same clientMessageId must not duplicate.
CREATE UNIQUE INDEX messages_sender_client_msg_idx
  ON messages (sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- §7 last-seen cursor: the most recent message each participant has read.
ALTER TABLE conversation_participants
  ADD COLUMN last_read_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;
