import { describe, expect, it } from 'vitest';
import { getBot, listBots, systemPromptFor } from './registry.js';

describe('bot registry', () => {
  it('exposes a non-empty system-curated roster', () => {
    expect(listBots().length).toBeGreaterThan(0);
  });

  it('never leaks the server-only systemPrompt over the wire', () => {
    for (const bot of listBots()) {
      expect(bot).not.toHaveProperty('systemPrompt');
    }
    expect(getBot('assistant')).not.toHaveProperty('systemPrompt');
  });

  it('includes the curated personas', () => {
    const byId = new Map(listBots().map((bot) => [bot.id, bot]));
    expect(byId.get('assistant')?.name).toBe('Grik');
    expect(byId.get('smith')?.name).toBe('Smith');
    expect(byId.get('bob')?.name).toBe('Bob');
  });

  it('returns a per-bot persona prompt for each known bot', () => {
    expect(systemPromptFor('assistant').toLowerCase()).toContain('lizardman');
    expect(systemPromptFor('smith').toLowerCase()).toContain('candy shop');
    expect(systemPromptFor('bob').toLowerCase()).toContain('mechanic');
  });

  it('falls back to a generic prompt for an unknown bot', () => {
    expect(systemPromptFor('nope')).toMatch(/helpful assistant/i);
  });
});
