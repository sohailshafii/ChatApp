import argon2 from 'argon2';

// Password hashing for §1 / §6: argon2id with per-password salts (built in).
//
// Cost parameters should be tuned to ~250 ms verify time on production
// hardware and reviewed periodically (§6). The values below are sensible
// starting points (argon2's own defaults exceed the RFC 9106 minimums); revisit
// once we can benchmark on the Fly machine class we deploy to.
const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
};

export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, HASH_OPTIONS);
}

export function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  return argon2.verify(hash, plaintext);
}
