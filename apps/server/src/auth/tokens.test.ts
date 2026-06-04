import { describe, it, expect } from 'vitest';
import {
  generateToken,
  hashToken,
  EMAIL_VERIFICATION_TTL_MS,
} from './tokens.js';

describe('hashToken', () => {
  it('is a deterministic sha256 hex digest', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});

describe('generateToken', () => {
  it('returns a raw token plus its hash, never equal', () => {
    const token = generateToken();
    expect(token.hash).toBe(hashToken(token.raw));
    expect(token.raw).not.toBe(token.hash);
    expect(token.raw).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });

  it('produces unique tokens', () => {
    expect(generateToken().raw).not.toBe(generateToken().raw);
  });
});

describe('EMAIL_VERIFICATION_TTL_MS', () => {
  it('is 24 hours (§1)', () => {
    expect(EMAIL_VERIFICATION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
