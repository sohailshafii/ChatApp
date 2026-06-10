import { describe, expect, it } from 'vitest';
import { avatarColor, monogram } from './avatarColor';

describe('avatarColor', () => {
  it('is deterministic for a given key', () => {
    expect(avatarColor('alice')).toBe(avatarColor('alice'));
  });

  it('returns a hex color from the palette', () => {
    expect(avatarColor('bob')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('maps different usernames across the palette (not all the same)', () => {
    const colors = new Set(
      ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace'].map(avatarColor),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('monogram', () => {
  it('uppercases the first character', () => {
    expect(monogram('alice')).toBe('A');
  });

  it('ignores leading whitespace', () => {
    expect(monogram('  bob')).toBe('B');
  });

  it('falls back to ? for an empty name', () => {
    expect(monogram('   ')).toBe('?');
  });
});
