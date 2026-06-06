import type { FastifyBaseLogger } from 'fastify';
import { loadConfig } from '../config.js';

// Dispatches the data-export "your download is ready" email (§6). Like the other
// mailers, the Resend HTTP client is deferred until RESEND_API_KEY is set; until
// then we log the time-limited download link so the flow is testable in dev.
export async function sendDataExportEmail(
  log: FastifyBaseLogger,
  email: string,
  link: string,
): Promise<void> {
  const { resendApiKey } = loadConfig();
  if (!resendApiKey) {
    log.warn(
      { email, link },
      'RESEND_API_KEY not set — skipping send; data export link logged for dev',
    );
    return;
  }
  log.info({ email, link }, 'data export email (Resend send not yet wired)');
}
