import { describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import {
  AnthropicBotProvider,
  OpenAiBotProvider,
  StubBotProvider,
  selectProvider,
} from './provider.js';

// A complete Config with the bot fields overridable per case. Only the bot
// fields drive selectProvider; the rest are filler to satisfy the type.
function config(overrides: Partial<Config>): Config {
  return {
    port: 8080,
    host: '0.0.0.0',
    logLevel: 'info',
    databaseUrl: 'postgres://x',
    appBaseUrl: 'http://localhost:5173',
    webDistDir: undefined,
    resendApiKey: undefined,
    mailFrom: 'onboarding@resend.dev',
    botProvider: 'anthropic',
    anthropicApiKey: undefined,
    openaiApiKey: undefined,
    anthropicModel: 'claude-opus-4-8',
    openaiModel: 'gpt-4o',
    botDailyTokenBudget: 20000,
    auditRetentionDays: 180,
    rateLimitMachineCount: 1,
    vapidPublicKey: undefined,
    vapidPrivateKey: undefined,
    vapidSubject: 'mailto:admin@example.com',
    vapidConfigured: false,
    cookieSecure: false,
    ...overrides,
  };
}

describe('selectProvider', () => {
  it('falls back to the stub when no key is set', () => {
    expect(selectProvider(config({}))).toBeInstanceOf(StubBotProvider);
  });

  it('uses Anthropic when named and its key is present', () => {
    const p = selectProvider(
      config({ botProvider: 'anthropic', anthropicApiKey: 'sk-ant-x' }),
    );
    expect(p).toBeInstanceOf(AnthropicBotProvider);
  });

  it('uses OpenAI when named and its key is present', () => {
    const p = selectProvider(
      config({ botProvider: 'openai', openaiApiKey: 'sk-openai-x' }),
    );
    expect(p).toBeInstanceOf(OpenAiBotProvider);
  });

  it('falls back to the stub when the named provider lacks its own key', () => {
    // BOT_PROVIDER=anthropic but only the OpenAI key is set — strict on purpose.
    const p = selectProvider(
      config({ botProvider: 'anthropic', openaiApiKey: 'sk-openai-x' }),
    );
    expect(p).toBeInstanceOf(StubBotProvider);
  });
});
