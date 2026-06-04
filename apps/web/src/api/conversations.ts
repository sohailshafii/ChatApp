import type { ConversationListResponse } from '@chatapp/shared';
import { apiFetch } from './client';

/**
 * GET /conversations — the authenticated user's conversation list (§2),
 * sorted by most recent activity. Throws `ApiError` (`unauthorized` if the
 * session is missing/expired).
 */
export async function listConversations(): Promise<ConversationListResponse> {
  return apiFetch<ConversationListResponse>('/conversations');
}
