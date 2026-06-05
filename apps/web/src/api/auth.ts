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

/**
 * DELETE /auth/account — re-authenticates with the current password, then hard
 * deletes the account (§6): anonymizes human-conversation history, removes bot
 * conversations, sessions, and push subscriptions. Resolves on success (the
 * server destroys the session); throws `ApiError` with `invalid_credentials`
 * (wrong password), `rate_limited`, or `validation_error`.
 */
export async function deleteAccount(password: string): Promise<void> {
  await apiFetch<void>('/auth/account', { method: 'DELETE', body: { password } });
}

/**
 * POST /auth/verify-email — consumes a one-time verification token (§1).
 * Resolves on success; throws `ApiError` with `invalid_token` / `expired_token`
 * (24h expiry) or `rate_limited`.
 */
export async function verifyEmail(token: string): Promise<void> {
  await apiFetch<void>('/auth/verify-email', { method: 'POST', body: { token } });
}

/**
 * POST /auth/verify-email/resend — requests a fresh verification link for an
 * email. The server responds generically to avoid revealing whether the
 * address has a pending account; throws `ApiError` only on `rate_limited`.
 */
export async function resendVerification(email: string): Promise<void> {
  await apiFetch<void>('/auth/verify-email/resend', { method: 'POST', body: { email } });
}

/**
 * POST /auth/password-reset/request — requests a reset link (§1). `identifier`
 * is a username or email; the server normalizes and responds generically to
 * avoid revealing whether an account exists. Throws `ApiError` only on
 * `rate_limited`.
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  await apiFetch<void>('/auth/password-reset/request', {
    method: 'POST',
    body: { identifier },
  });
}

/**
 * POST /auth/password-reset/confirm — sets a new password from a reset token
 * (1h expiry) and invalidates all existing sessions (§1). Throws `ApiError`
 * with `invalid_token` / `expired_token`, `validation_error`, or `rate_limited`.
 */
export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<void> {
  await apiFetch<void>('/auth/password-reset/confirm', {
    method: 'POST',
    body: { token, newPassword },
  });
}
