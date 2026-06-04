-- 006_hide_conversation: §2 "leave/hide". Hides a conversation from one
-- participant's list without affecting the peer. New activity un-hides it.

ALTER TABLE conversation_participants
  ADD COLUMN hidden boolean NOT NULL DEFAULT false;
