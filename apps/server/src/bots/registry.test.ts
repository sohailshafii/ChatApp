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

  it('returns a per-bot persona prompt for a known bot', () => {
    const prompt = systemPromptFor('assistant');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.toLowerCase()).toContain('lizardman');
  });

  it('falls back to a generic prompt for an unknown bot', () => {
    expect(systemPromptFor('nope')).toMatch(/helpful assistant/i);
  });
});
