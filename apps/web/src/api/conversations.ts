import type {
  ConversationListResponse,
  ConversationResponse,
  MessagePage,
} from '@chatapp/shared';
import { apiFetch } from './client';

/**
 * GET /conversations — the authenticated user's conversation list (§2),
 * sorted by most recent activity. Throws `ApiError` (`unauthorized` if the
 * session is missing/expired).
 */
export async function listConversations(): Promise<ConversationListResponse> {
  return apiFetch<ConversationListResponse>('/conversations');
}

/** GET /conversations/:id — a single conversation's summary (peer, etc.). */
export async function getConversation(id: string): Promise<ConversationResponse> {
  return apiFetch<ConversationResponse>(`/conversations/${id}`);
}

/**
 * GET /conversations/:id/messages — a page of history (§4), oldest-first.
 * `before` is a cursor (message id) from a prior page's `nextBefore`.
 */
export async function getMessages(
  id: string,
  opts: { before?: string; limit?: number } = {},
): Promise<MessagePage> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiFetch<MessagePage>(`/conversations/${id}/messages${qs ? `?${qs}` : ''}`);
}

/**
 * POST /conversations/:id/read — advance the last-seen cursor to clear unread
 * (§7), marking everything up to `messageId` as read.
 */
export async function markConversationRead(id: string, messageId: string): Promise<void> {
  await apiFetch<void>(`/conversations/${id}/read`, {
    method: 'POST',
    body: { messageId },
  });
}
