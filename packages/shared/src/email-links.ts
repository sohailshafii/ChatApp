// Web client route paths that the SERVER embeds in outbound email links, pinned
// here so the email builders and the web router can't drift (REQUIREMENTS.md §1).
// The full URL the user receives is `${APP_BASE_URL}${PATH}?token=<raw token>`.

// Email verification link target (signup + resend).
export const EMAIL_VERIFY_PATH = '/verify-email';

// Password-reset confirmation link target — where the reset email lands so the
// user can set a new password.
export const PASSWORD_RESET_CONFIRM_PATH = '/password-reset/confirm';
