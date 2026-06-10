import type { FastifyBaseLogger } from 'fastify';
import { PASSWORD_RESET_CONFIRM_PATH } from '@chatapp/shared';
import { loadConfig } from '../config.js';
import { deliverEmail } from './transport.js';

// Dispatches the password-reset email (§1) via Resend. In local dev —
// RESEND_API_KEY unset — we log the reset link instead, keeping the flow testable
// without a mailbox. The link points at the web confirm route
// (PASSWORD_RESET_CONFIRM_PATH) so it lands on the reset page.
export async function sendPasswordResetEmail(
  log: FastifyBaseLogger,
  email: string,
  rawToken: string,
): Promise<void> {
  const { appBaseUrl, resendApiKey, mailFrom } = loadConfig();
  const link = `${appBaseUrl}${PASSWORD_RESET_CONFIRM_PATH}?token=${encodeURIComponent(rawToken)}`;

  if (!resendApiKey) {
    log.warn(
      { email, link },
      'RESEND_API_KEY not set — skipping send; password-reset link logged for dev',
    );
    return;
  }

  await deliverEmail(
    log,
    {
      to: email,
      subject: 'Reset your ChatApp password',
      text: `We received a request to reset your ChatApp password. Open this link to choose a new one:\n\n${link}\n\nThe link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
      html: `<p>We received a request to reset your ChatApp password. Open this link to choose a new one:</p><p><a href="${link}">${link}</a></p><p>The link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
    },
    { from: mailFrom, apiKey: resendApiKey },
  );
}
