import type { SignupRequest } from '@chatapp/shared';
import { apiFetch } from './client';

// Auth endpoints (REQUIREMENTS.md §1). More will be added as login,
// verification, and password-reset flows land.

/**
 * POST /auth/signup — creates an unverified account and triggers a
 * verification email. Resolves on success (empty 200 body); throws `ApiError`
 * with `username_taken` / `email_taken` / `validation_error` / `rate_limited`
 * on the expected failure paths.
 */
export async function signup(input: SignupRequest): Promise<void> {
  await apiFetch<void>('/auth/signup', { method: 'POST', body: input });
}
