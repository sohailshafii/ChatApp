import type { Bot } from '@chatapp/shared';

// System-curated bots (§2). v1 has no user-created bots, so this in-code registry
// is the canonical source — consumed by conversation peer resolution now and by
// GET /bots later. The roster/personas are a product decision tied to bot
// orchestration; seeded with a single general assistant as a placeholder.
const BOTS: readonly Bot[] = [
  {
    id: 'assistant',
    name: 'Assistant',
    description: 'A general-purpose AI assistant.',
  },
];

const BY_ID = new Map<string, Bot>(BOTS.map((bot) => [bot.id, bot]));

export function listBots(): readonly Bot[] {
  return BOTS;
}

export function getBot(id: string): Bot | undefined {
  return BY_ID.get(id);
}
