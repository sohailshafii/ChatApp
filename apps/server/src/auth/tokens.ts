import { randomBytes, createHash } from 'node:crypto';

// Opaque one-time tokens for email verification and (later) password reset.
//
// The raw token is high-entropy and goes only into the emailed link. We persist
// a SHA-256 hash of it: a token is opaque and single-use, so a fast hash is the
// right primitive (unlike passwords, there is nothing to brute-force offline).

const TOKEN_BYTES = 32; // 256 bits -> 43-char base64url, within tokenSchema (16..256).

export type GeneratedToken = {
  // The value to embed in the link sent to the user. Never stored.
  raw: string;
  // The value to persist (token_hash column).
  hash: string;
};

export function generateToken(): GeneratedToken {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// §1: email verification links expire after 24h.
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
