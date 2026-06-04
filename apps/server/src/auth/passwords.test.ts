import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

const PASSWORD = 'correct horse battery staple';

describe('password hashing', () => {
  it('hashes to an argon2id string distinct from the input', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toBe(PASSWORD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('uses a per-password salt (same input, different hashes)', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, 'wrong wrong wrong')).toBe(false);
  });
});
