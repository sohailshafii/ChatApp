import type { FastifyBaseLogger } from 'fastify';
import { loadConfig } from '../config.js';
import { deliverEmail } from './transport.js';

// The web signup route (apps/web App.tsx: <Route path="signup">). Hardcoded here
// rather than in @chatapp/shared because only the server builds this link — the
// web app never needs the constant (unlike EMAIL_VERIFY_PATH, which it consumes).
const SIGNUP_PATH = '/signup';

// Dispatches an invite email (invite-only signup, §1) via Resend. As with the
// other mailers, in local dev — RESEND_API_KEY unset — the link is logged
// instead so the flow is testable without a mailbox. Best-effort: a send failure
// is logged by deliverEmail, never thrown.
export async function sendInviteEmail(
  log: FastifyBaseLogger,
  email: string,
): Promise<void> {
  const { appBaseUrl, resendApiKey, mailFrom } = loadConfig();
  const link = `${appBaseUrl}${SIGNUP_PATH}?email=${encodeURIComponent(email)}`;

  if (!resendApiKey) {
    log.warn(
      { email, link },
      'RESEND_API_KEY not set — skipping send; invite link logged for dev',
    );
    return;
  }

  await deliverEmail(
    log,
    {
      to: email,
      subject: "You're invited to ChatApp",
      text: `You've been invited to ChatApp. Create your account using this email address (${email}):\n\n${link}\n\nIf you weren't expecting this invitation, you can ignore this email.`,
      html: `<p>You've been invited to ChatApp. Create your account using this email address (<strong>${email}</strong>):</p><p><a href="${link}">${link}</a></p><p>If you weren't expecting this invitation, you can ignore this email.</p>`,
    },
    { from: mailFrom, apiKey: resendApiKey },
  );
}
