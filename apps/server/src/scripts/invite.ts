import type { FastifyBaseLogger } from 'fastify';
import { emailSchema } from '@chatapp/shared';
import { loadConfig } from '../config.js';
import { closePool } from '../db/pool.js';
import { createInvite, INVITE_TTL_DAYS } from '../auth/invites.js';
import { sendInviteEmail } from '../mail/invite.js';

// Operator CLI to mint an email-bound signup invite (invite-only mode):
//
//   npm run invite -- alice@example.com            # default 14-day expiry
//   npm run invite -- alice@example.com --days 30
//
// Inserts (or refreshes) the invite, emails the recipient a signup link
// (logged instead of sent when RESEND_API_KEY is unset), and prints the link +
// expiry. Run locally against your dev DB, or in production via
// `fly ssh console` (DATABASE_URL is already in the machine's env).

const USAGE =
  'Usage: npm run invite -- <email> [--days N]\n' +
  `       N = invite validity in days (default ${INVITE_TTL_DAYS})`;

function parseArgs(argv: string[]): { email: string; days: number } {
  let email: string | undefined;
  let days = INVITE_TTL_DAYS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--days') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        fail(`--days must be a positive integer (got "${argv[i]}")`);
      }
      days = value;
    } else if (!arg.startsWith('-') && email === undefined) {
      email = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }
  if (email === undefined) fail('Missing <email> argument.');
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) fail(`Invalid email address: ${email}`);
  return { email: parsed.data, days };
}

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

// Minimal logger shim so the dev-mode "link logged" path and best-effort send in
// sendInviteEmail/deliverEmail work outside a Fastify request. Only info/warn/
// error are exercised; the cast covers the rest of the FastifyBaseLogger surface.
const log = {
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
} as unknown as FastifyBaseLogger;

async function main(): Promise<void> {
  const { email, days } = parseArgs(process.argv.slice(2));
  const { appBaseUrl } = loadConfig();

  const { email: stored, expiresAt } = await createInvite(email, days);
  await sendInviteEmail(log, stored);

  console.log(`\n✓ Invited ${stored}`);
  console.log(`  Signup link: ${appBaseUrl}/signup`);
  console.log(`  Expires:     ${expiresAt.toISOString()}`);
  console.log(
    '\n  (They must sign up with this exact email address. Re-run to re-issue.)',
  );
}

main()
  .catch((err) => {
    console.error('Failed to create invite:', err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
