import type { FastifyBaseLogger } from 'fastify';
import { loadConfig } from '../config.js';
import { deliverEmail } from './transport.js';

// Dispatches the data-export "your download is ready" email (§6) via Resend. In
// local dev — RESEND_API_KEY unset — we log the time-limited download link
// instead so the flow is testable without a mailbox.
export async function sendDataExportEmail(
  log: FastifyBaseLogger,
  email: string,
  link: string,
): Promise<void> {
  const { resendApiKey, mailFrom } = loadConfig();
  if (!resendApiKey) {
    log.warn(
      { email, link },
      'RESEND_API_KEY not set — skipping send; data export link logged for dev',
    );
    return;
  }

  await deliverEmail(
    log,
    {
      to: email,
      subject: 'Your ChatApp data export is ready',
      text: `Your ChatApp data export is ready to download:\n\n${link}\n\nThe link expires in 24 hours.`,
      html: `<p>Your ChatApp data export is ready to download:</p><p><a href="${link}">${link}</a></p><p>The link expires in 24 hours.</p>`,
    },
    { from: mailFrom, apiKey: resendApiKey },
  );
}
