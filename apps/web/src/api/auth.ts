import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  SignupRequest,
} from '@chatapp/shared';
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

/**
 * POST /auth/login — exchanges username + password for a session cookie
 * (set by the server) and returns the authenticated account. Throws `ApiError`
 * with `invalid_credentials`, `unverified` (account exists but email not
 * confirmed), `rate_limited`, or `validation_error`.
 */
export async function login(input: LoginRequest): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: input });
}

/**
 * GET /auth/me — returns the authenticated account, or throws `ApiError`
 * with `unauthorized` (status 401) when there is no valid session. Used to
 * rehydrate auth state on app load.
 */
export async function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/me');
}

/** POST /auth/logout — deletes the session server-side and clears the cookie. */
export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
}
