import { z } from 'zod';

// Server configuration, loaded and validated from the environment once at startup.
// Secrets (DB creds, RESEND_API_KEY, …) come from env / Fly secrets — never source.
// See REQUIREMENTS.md §6 (Secrets handling).

const envSchema = z.object({
  // Fly injects PORT; default to 8080 to match fly.toml internal_port locally.
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Public origin of the web app, used to build verification / reset links.
  // Defaults to the Vite dev server origin.
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),

  // Directory of the built web SPA (Vite `dist`) to serve at the root in
  // production (single-origin: SPA at `/`, API at `/api`). Set in the Docker
  // image; unset in dev/test, where Vite serves the SPA, so the server skips
  // static serving entirely. See src/static.ts.
  WEB_DIST_DIR: z.string().optional(),

  // Invite-only signup (§1 access gating). When enabled, POST /auth/signup
  // requires a pending invite matching the submitted email; uninvited signups
  // get `invite_required`. Off by default (open signup) so the template runs
  // out of the box; operators set INVITE_ONLY=true (env / Fly secret) and mint
  // invites with `npm run invite`. Accepts only "true"/"1" as true.
  INVITE_ONLY: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  // Optional in dev: when unset, verification emails are logged instead of sent.
  RESEND_API_KEY: z.string().optional(),
  // The From address on outgoing mail. Resend only accepts a sender on a domain
  // verified in your account; the default works out-of-the-box for testing
  // (Resend delivers it to the account owner). Accepts "Name <email>" too.
  MAIL_FROM: z.string().min(1).default('onboarding@resend.dev'),

  // Bot reply provider (§3). The active provider is the one named here *and*
  // holding an API key; with neither key set the orchestrator falls back to the
  // stub reply (like the email sender's "log instead of send" posture).
  BOT_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  // Overridable so a cheaper model can be set without a code change.
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  // §cost: per-user token guardrail for bot replies (input + output), counted
  // over a fixed 5-hour window (see bots/budget.ts).
  BOT_TOKEN_BUDGET: z.coerce.number().int().nonnegative().default(20000),

  // §6 retention: auth audit events are kept this many days, then pruned by the
  // retention sweeper (operational PII is shorter-lived; audit logs ~180d).
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(180),

  // Web Push (§5). Optional in dev: with no keypair, push is disabled (the
  // dispatcher no-ops, the vapid-public-key endpoint errors). Generate with
  // `npx web-push generate-vapid-keys`. Prod gets these from Fly secrets (§6).
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),

  // Multi-machine scale-out (docs/multi-machine.md). Optional: when unset, the
  // rate-limit counters and WS hub stay in-process (the single-machine default,
  // N=1) — same "optional infra" posture as RESEND/VAPID/bot keys, so local dev
  // and tests run with no Redis. When set, it's the connection string for the
  // shared Redis/Valkey backing those (phases land incrementally; this is just
  // the phase-1 plumbing, so a set URL connects but nothing uses it yet).
  REDIS_URL: z.string().optional(),
});

export type Config = {
  port: number;
  host: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  databaseUrl: string;
  appBaseUrl: string;
  webDistDir: string | undefined;
  inviteOnly: boolean;
  resendApiKey: string | undefined;
  mailFrom: string;
  botProvider: z.infer<typeof envSchema>['BOT_PROVIDER'];
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;
  anthropicModel: string;
  openaiModel: string;
  botTokenBudget: number;
  auditRetentionDays: number;
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
  vapidSubject: string;
  // True only when the full VAPID keypair is present; gates Web Push (§5).
  vapidConfigured: boolean;
  redisUrl: string | undefined;
  // True when REDIS_URL is set; selects the (future) Redis-backed limiters/hub
  // over the in-process fallbacks. See docs/multi-machine.md.
  redisConfigured: boolean;
  // Whether auth cookies get the Secure attribute. Derived from APP_BASE_URL's
  // scheme: off for local http dev, on for https (prod). See §6.
  cookieSecure: boolean;
};

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const e = parsed.data;
  cached = {
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    appBaseUrl: e.APP_BASE_URL,
    webDistDir: e.WEB_DIST_DIR,
    inviteOnly: e.INVITE_ONLY,
    resendApiKey: e.RESEND_API_KEY,
    mailFrom: e.MAIL_FROM,
    botProvider: e.BOT_PROVIDER,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    openaiApiKey: e.OPENAI_API_KEY,
    anthropicModel: e.ANTHROPIC_MODEL,
    openaiModel: e.OPENAI_MODEL,
    botTokenBudget: e.BOT_TOKEN_BUDGET,
    auditRetentionDays: e.AUDIT_RETENTION_DAYS,
    vapidPublicKey: e.VAPID_PUBLIC_KEY,
    vapidPrivateKey: e.VAPID_PRIVATE_KEY,
    vapidSubject: e.VAPID_SUBJECT,
    vapidConfigured: Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY),
    redisUrl: e.REDIS_URL,
    redisConfigured: Boolean(e.REDIS_URL),
    cookieSecure: e.APP_BASE_URL.startsWith('https'),
  };
  return cached;
}
