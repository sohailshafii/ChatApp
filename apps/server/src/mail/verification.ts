import type { FastifyBaseLogger } from 'fastify';
import { EMAIL_VERIFY_PATH } from '@chatapp/shared';
import { loadConfig } from '../config.js';
import { deliverEmail } from './transport.js';

// Dispatches the signup verification email (§1) via Resend (REQUIREMENTS.md
// Decisions). In local dev — RESEND_API_KEY unset — we log the verification link
// instead so the flow is testable end-to-end without a mailbox.
export async function sendVerificationEmail(
  log: FastifyBaseLogger,
  email: string,
  rawToken: string,
): Promise<void> {
  const { appBaseUrl, resendApiKey, mailFrom } = loadConfig();
  const link = `${appBaseUrl}${EMAIL_VERIFY_PATH}?token=${encodeURIComponent(rawToken)}`;

  if (!resendApiKey) {
    log.warn(
      { email, link },
      'RESEND_API_KEY not set — skipping send; verification link logged for dev',
    );
    return;
  }

  await deliverEmail(
    log,
    {
      to: email,
      subject: 'Verify your email for ChatApp',
      text: `Welcome to ChatApp! Confirm your email address by opening this link:\n\n${link}\n\nThe link expires in 24 hours. If you didn't sign up, you can ignore this email.`,
      html: `<p>Welcome to ChatApp! Confirm your email address by opening this link:</p><p><a href="${link}">${link}</a></p><p>The link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>`,
    },
    { from: mailFrom, apiKey: resendApiKey },
  );
}
