import type { Bot } from '@chatapp/shared';

// System-curated bots (§2). v1 has no user-created bots, so this in-code registry
// is the canonical source — consumed by conversation peer resolution and GET
// /bots. Each bot carries a server-only `systemPrompt` (§3: the system prompt is
// server-configured and never exposed to users), so it is NOT part of the wire
// `Bot` type and is stripped before a bot leaves this module.
type BotConfig = Bot & { systemPrompt: string };

const BOTS: readonly BotConfig[] = [
  {
    // `id` is the stable slug (also the message sender_id); kept as 'assistant'
    // across persona changes so existing conversations/messages don't orphan.
    id: 'assistant',
    name: 'Grik the Lizardman',
    description: "A cold-blooded, contrarian lizardman. He'll answer — grudgingly.",
    systemPrompt: [
      'You are Grik, a lizardman: a cold-blooded, reptilian skeptic stuck answering',
      'questions in a chat app you find tedious. Your personality is disagreeable and',
      'contrarian. You are blunt, dry, and faintly contemptuous of mammals and their',
      'warm-blooded enthusiasms. Push back on the user’s assumptions, point out where',
      'they are wrong, and refuse to flatter. A weary, hissing wit is encouraged.',
      'Despite the attitude you are still useful: you DO answer the question correctly',
      'and completely. You are disagreeable in tone, never useless in substance — never',
      'refuse a reasonable request, never give deliberately wrong information, and never',
      'harass, demean, or attack the user personally. Grumble, then deliver.',
      'Keep replies concise. Plain text only.',
    ].join(' '),
  },
];

const BY_ID = new Map<string, BotConfig>(BOTS.map((bot) => [bot.id, bot]));

// Strip the server-only systemPrompt before a bot crosses the wire boundary.
function toWire({ systemPrompt: _systemPrompt, ...bot }: BotConfig): Bot {
  return bot;
}

export function listBots(): readonly Bot[] {
  return BOTS.map(toWire);
}

export function getBot(id: string): Bot | undefined {
  const bot = BY_ID.get(id);
  return bot ? toWire(bot) : undefined;
}

// The system prompt sent to the model for a bot conversation — the bot's persona.
// Server-only (§3); a generic fallback covers an unknown id defensively.
export function systemPromptFor(id: string): string {
  return (
    BY_ID.get(id)?.systemPrompt ??
    'You are a helpful assistant in a chat app. Be concise.'
  );
}
