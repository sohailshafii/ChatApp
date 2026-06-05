import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  tokenSchema,
  usernameSchema,
} from './validation.js';
import { accountUserSchema } from './user.js';

// Wire schemas for §1 (Accounts & Identity).
// Endpoint paths are documented alongside each schema; the canonical path
// list will live in the server's route module.

// --- Signup ---
// POST /auth/signup
export const signupRequestSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;
// Success: 200 with empty body. Verification email is sent asynchronously.

// --- Email verification ---
// POST /auth/verify-email
export const verifyEmailRequestSchema = z.object({
  token: tokenSchema,
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

// POST /auth/verify-email/resend
export const resendVerificationRequestSchema = z.object({
  email: emailSchema,
});
export type ResendVerificationRequest = z.infer<
  typeof resendVerificationRequestSchema
>;

// --- Login / logout ---
// POST /auth/login
export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  user: accountUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

// POST /auth/logout — no body, session cookie required.

// --- Password reset ---
// POST /auth/password-reset/request
// `identifier` is either username or email; the server normalizes.
export const passwordResetRequestSchema = z.object({
  identifier: z.string().min(1).max(254),
});
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

// POST /auth/password-reset/confirm
export const passwordResetConfirmSchema = z.object({
  token: tokenSchema,
  newPassword: passwordSchema,
});
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

// --- Current account ---
// GET /auth/me — returns the authenticated user, or 401.
export const meResponseSchema = z.object({
  user: accountUserSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// --- Account deletion (§6) ---
// DELETE /auth/account — re-authenticates with the current password, then
// performs an immediate hard delete: anonymizes the user in human-conversation
// history ("Deleted user"), hard-deletes bot conversations, and removes session
// tokens + push subscriptions. The body carries the password (a DELETE with a
// body, matching the resource-deletion verb used elsewhere, e.g.
// DELETE /conversations/:id). Session cookie still required.
//
// Success: 200 with empty body; the server destroys the session. A wrong
// password is reported as `invalid_credentials`.
export const deleteAccountRequestSchema = z.object({
  password: passwordSchema,
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
