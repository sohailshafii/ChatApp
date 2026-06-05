import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { BotErrorCode } from '@chatapp/shared';
import { loadConfig, type Config } from '../config.js';

// Bot reply provider seam (§3). The orchestrator streams replies through this
// interface. The active provider is chosen by BOT_PROVIDER + the presence of the
// matching API key; with no key configured the stub is used, mirroring the email
// sender's "log instead of send" posture so dev and the test suite run keyless.

export type BotTurn = { role: 'user' | 'assistant'; content: string };

export interface BotReplyInput {
  systemPrompt: string;
  history: BotTurn[];
}

// Token usage for one reply, returned by the generator after the last delta.
// Drives the per-user/day budget (§cost). See `budget.ts`.
export type BotUsage = { inputTokens: number; outputTokens: number };

export interface BotProvider {
  // Streams the assistant reply as text deltas, then returns its token usage.
  streamReply(input: BotReplyInput): AsyncGenerator<string, BotUsage, void>;
}

// Thrown by a provider when an upstream call fails, carrying the wire code the
// orchestrator surfaces on the bot_error frame. Anything that isn't a BotError
// is treated as `internal_error`.
export class BotError extends Error {
  constructor(
    readonly code: BotErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'BotError';
  }
}

// Chat replies render text only, so thinking is left off (it would add latency
// and token cost with no visible benefit). This bounds a runaway generation; the
// reply can't exceed the §3 message cap anyway.
const MAX_OUTPUT_TOKENS = 4096;

export class AnthropicBotProvider implements BotProvider {
  private readonly client: Anthropic;
  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async *streamReply(input: BotReplyInput): AsyncGenerator<string, BotUsage, void> {
    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: input.systemPrompt,
        messages: input.history.map((t) => ({ role: t.role, content: t.content })),
      });
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        }
      }
      const final = await stream.finalMessage();
      return {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      };
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new BotError('provider_unavailable', `Anthropic: ${err.message}`, {
          cause: err,
        });
      }
      throw err;
    }
  }
}

export class OpenAiBotProvider implements BotProvider {
  private readonly client: OpenAI;
  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async *streamReply(input: BotReplyInput): AsyncGenerator<string, BotUsage, void> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        stream: true,
        // Ask for a final usage-only chunk so we can charge the budget.
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: input.systemPrompt },
          ...input.history.map((t) => ({ role: t.role, content: t.content })),
        ],
      });
      let usage: BotUsage = { inputTokens: 0, outputTokens: 0 };
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
      }
      return usage;
    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        throw new BotError('provider_unavailable', `OpenAI: ${err.message}`, {
          cause: err,
        });
      }
      throw err;
    }
  }
}

// Placeholder provider: streams a fixed reply in word-sized chunks so the full
// streaming path (bot_start -> chunks -> bot_end) is exercised in dev and tests
// without a model or API key.
export class StubBotProvider implements BotProvider {
  async *streamReply(): AsyncGenerator<string, BotUsage, void> {
    const text =
      'Thanks for the message! Language-model replies are not wired up yet, ' +
      'so this is a placeholder response.';
    for (const word of text.split(' ')) {
      yield `${word} `;
    }
    // No model call — estimate ~4 chars/token so the keyless dev path still
    // records something against the budget.
    return { inputTokens: 0, outputTokens: Math.ceil(text.length / 4) };
  }
}

const stub = new StubBotProvider();

let cached: BotProvider | undefined;
let override: BotProvider | undefined;

// Test seam: inject a provider (e.g. one that throws a specific BotError), or
// pass undefined to clear the override and re-select from config on next call.
export function setBotProvider(provider: BotProvider | undefined): void {
  override = provider;
  cached = undefined;
}

// The active provider, chosen by BOT_PROVIDER + the matching key. The named
// provider must hold its own key; otherwise (and when neither key is set) the
// stub is used.
export function getBotProvider(): BotProvider {
  if (override) return override;
  if (cached) return cached;
  cached = selectProvider(loadConfig());
  return cached;
}

// Pure selection by BOT_PROVIDER + matching key. Exported for unit testing the
// key-gating without going through the cached singleton.
export function selectProvider(config: Config): BotProvider {
  if (config.botProvider === 'anthropic' && config.anthropicApiKey) {
    return new AnthropicBotProvider(config.anthropicApiKey, config.anthropicModel);
  }
  if (config.botProvider === 'openai' && config.openaiApiKey) {
    return new OpenAiBotProvider(config.openaiApiKey, config.openaiModel);
  }
  return stub;
}
