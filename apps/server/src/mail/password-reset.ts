import type { FastifyBaseLogger } from 'fastify';
import { PASSWORD_RESET_CONFIRM_PATH } from '@chatapp/shared';
import { loadConfig } from '../config.js';

// Dispatches the password-reset email (§1). Same posture as the verification
// email: the Resend HTTP client is deferred until RESEND_API_KEY is wired, so
// until then — and in local dev — we log the reset link instead of sending it,
// keeping the flow testable without a mailbox. The link points at the web
// confirm route (PASSWORD_RESET_CONFIRM_PATH) so it lands on the reset page.
export async function sendPasswordResetEmail(
  log: FastifyBaseLogger,
  email: string,
  rawToken: string,
): Promise<void> {
  const { appBaseUrl, resendApiKey } = loadConfig();
  const link = `${appBaseUrl}${PASSWORD_RESET_CONFIRM_PATH}?token=${encodeURIComponent(rawToken)}`;

  if (!resendApiKey) {
    log.warn(
      { email, link },
      'RESEND_API_KEY not set — skipping send; password-reset link logged for dev',
    );
    return;
  }

  // TODO: send via Resend once the provider client is added. For now, even with
  // a key present, we log rather than call out.
  log.info({ email, link }, 'password-reset email (Resend send not yet wired)');
}
