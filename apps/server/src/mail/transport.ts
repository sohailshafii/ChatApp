import type { FastifyBaseLogger } from 'fastify';

// The shared Resend delivery step for all transactional mail (§1/§6). The
// per-message mailers (verification, password-reset, data-export) build their
// subject/body and the dev "log the link" fallback; this module owns the actual
// HTTP send so it lives in one place and can be swapped for a fake in tests
// (`setMailSender` — the same seam pattern as the push sender).

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type MailSender = (
  email: OutgoingEmail,
  opts: { from: string; apiKey: string },
) => Promise<void>;

// Real transport: a plain POST to the Resend API (Node's global fetch — no SDK
// dependency). Throws on a non-2xx so the caller can log it.
export const resendSender: MailSender = async (email, { from, apiKey }) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend responded ${res.status}: ${detail}`);
  }
};

let sender: MailSender = resendSender;

// Test seam: swap the transport so tests never hit the network.
export function setMailSender(s: MailSender): void {
  sender = s;
}
export function resetMailSender(): void {
  sender = resendSender;
}

// Sends one email via the active transport. **Best-effort**: a failure is logged,
// never thrown, so a mail problem (bad key, unverified sender domain, Resend
// outage) never breaks the auth/account flow that triggered it.
export async function deliverEmail(
  log: FastifyBaseLogger,
  email: OutgoingEmail,
  opts: { from: string; apiKey: string },
): Promise<void> {
  try {
    await sender(email, opts);
    log.info({ to: email.to, subject: email.subject }, 'email sent via Resend');
  } catch (err) {
    log.error({ err, to: email.to }, 'Resend send failed');
  }
}
