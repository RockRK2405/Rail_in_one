import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/server/auth/password';

describe('password hashing (argon2id)', () => {
  it('produces an argon2id encoded hash that is not the plaintext', async () => {
    const hash = await hashPassword('Sup3rSecret!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('Sup3rSecret!');
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('Sup3rSecret!');
    expect(await verifyPassword(hash, 'Sup3rSecret!')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('Sup3rSecret!');
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('salts: two hashes of the same password differ', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toEqual(b);
  });

  it('returns false (never throws) for a malformed hash', async () => {
    expect(await verifyPassword('not-a-real-hash', 'x')).toBe(false);
  });
});
