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

  // Optional in dev: when unset, verification emails are logged instead of sent.
  RESEND_API_KEY: z.string().optional(),

  // Bot reply provider (§3). The active provider is the one named here *and*
  // holding an API key; with neither key set the orchestrator falls back to the
  // stub reply (like the email sender's "log instead of send" posture).
  BOT_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  // Overridable so a cheaper model can be set without a code change.
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  // §cost: per-user/day token guardrail for bot replies (input + output).
  BOT_DAILY_TOKEN_BUDGET: z.coerce.number().int().nonnegative().default(20000),
});

export type Config = {
  port: number;
  host: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  databaseUrl: string;
  appBaseUrl: string;
  resendApiKey: string | undefined;
  botProvider: z.infer<typeof envSchema>['BOT_PROVIDER'];
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;
  anthropicModel: string;
  openaiModel: string;
  botDailyTokenBudget: number;
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
    resendApiKey: e.RESEND_API_KEY,
    botProvider: e.BOT_PROVIDER,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    openaiApiKey: e.OPENAI_API_KEY,
    anthropicModel: e.ANTHROPIC_MODEL,
    openaiModel: e.OPENAI_MODEL,
    botDailyTokenBudget: e.BOT_DAILY_TOKEN_BUDGET,
    cookieSecure: e.APP_BASE_URL.startsWith('https'),
  };
  return cached;
}
