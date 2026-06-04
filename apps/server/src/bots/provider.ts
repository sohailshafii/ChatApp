// Bot reply provider seam (§3). The orchestrator streams replies through this
// interface; real OpenAI/Anthropic clients land behind it in a follow-up. Until
// then — and whenever no provider API key is configured — the stub is used,
// mirroring the email sender's "log instead of send" posture.

export type BotTurn = { role: 'user' | 'assistant'; content: string };

export interface BotReplyInput {
  systemPrompt: string;
  history: BotTurn[];
}

export interface BotProvider {
  // Streams the assistant reply as text deltas.
  streamReply(input: BotReplyInput): AsyncIterable<string>;
}

// Placeholder provider: streams a fixed reply in word-sized chunks so the full
// streaming path (bot_start -> chunks -> bot_end) is exercised in dev and tests
// without a model or API key.
class StubBotProvider implements BotProvider {
  async *streamReply(): AsyncIterable<string> {
    const text =
      'Thanks for the message! Language-model replies are not wired up yet, ' +
      'so this is a placeholder response.';
    for (const word of text.split(' ')) {
      yield `${word} `;
    }
  }
}

const stub = new StubBotProvider();

// The active provider. Real providers (selected by BOT_PROVIDER + the presence of
// an API key) are added in a follow-up; for now everything uses the stub.
export function getBotProvider(): BotProvider {
  return stub;
}
