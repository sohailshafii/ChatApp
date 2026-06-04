-- 004_conversations: §2 conversations and their participants. v1 is strictly
-- 1-on-1 — a conversation is between two humans, or one human and a system bot.

CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The peer bot's slug when the conversation is with a bot; NULL for human-human.
  bot_id     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Bumped on each new message; drives the conversation-list ordering (§2).
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, account_id)
);

-- "List my conversations" filters by participant.
CREATE INDEX conversation_participants_account_id_idx
  ON conversation_participants (account_id);
