import type { BotListResponse } from '@chatapp/shared';
import { apiFetch } from './client';

/** GET /bots — the system-curated bots a user can start a conversation with (§2). */
export async function listBots(): Promise<BotListResponse> {
  return apiFetch<BotListResponse>('/bots');
}
