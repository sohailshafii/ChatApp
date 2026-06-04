import { describe, it, expect } from 'vitest';
import { generateCsrfToken, csrfTokensMatch } from './csrf.js';

describe('generateCsrfToken', () => {
  it('produces distinct, URL-safe, high-entropy tokens', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes -> 43 chars
  });
});

describe('csrfTokensMatch', () => {
  it('accepts identical cookie and header values', () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  it('rejects differing values of equal length', () => {
    expect(csrfTokensMatch('a'.repeat(43), 'b'.repeat(43))).toBe(false);
  });

  it('rejects a length mismatch without throwing', () => {
    expect(csrfTokensMatch('short', 'much-longer-value')).toBe(false);
  });

  it('rejects when either side is missing', () => {
    expect(csrfTokensMatch(undefined, 'x')).toBe(false);
    expect(csrfTokensMatch('x', undefined)).toBe(false);
    expect(csrfTokensMatch(undefined, undefined)).toBe(false);
  });

  it('compares against the first value when the header repeats', () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, [token, 'other'])).toBe(true);
    expect(csrfTokensMatch(token, ['other', token])).toBe(false);
  });
});
