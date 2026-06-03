import type { FastifyBaseLogger } from 'fastify';
import { loadConfig } from '../config.js';

// Dispatches the signup verification email (§1).
//
// Resend is the chosen provider (REQUIREMENTS.md Decisions), but wiring the
// actual HTTP client is deferred until RESEND_API_KEY is configured. Until then
// — and in local dev generally — we log the verification link so the flow is
// testable end-to-end without a mailbox.
export async function sendVerificationEmail(
  log: FastifyBaseLogger,
  email: string,
  rawToken: string,
): Promise<void> {
  const { appBaseUrl, resendApiKey } = loadConfig();
  const link = `${appBaseUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;

  if (!resendApiKey) {
    log.warn(
      { email, link },
      'RESEND_API_KEY not set — skipping send; verification link logged for dev',
    );
    return;
  }

  // TODO: send via Resend once the provider client is added. For now, even with
  // a key present, we log rather than call out so signup never blocks on email.
  log.info({ email, link }, 'verification email (Resend send not yet wired)');
}
