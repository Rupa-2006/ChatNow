import { describe, expect, it } from 'vitest';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../src/utils/password.js';

describe('password hashing', () => {
  it('produces an Argon2id hash with the configured parameters', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=19456,t=2,p=1');
    expect(hash).not.toContain('correct horse battery');
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse batterY')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-1'), hashPassword('same-password-1')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'same-password-1')).toBe(true);
    expect(await verifyPassword(b, 'same-password-1')).toBe(true);
  });

  it('treats a malformed stored hash as a failed verification instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });

  it('dummy verification resolves without throwing', async () => {
    await expect(verifyAgainstDummy('whatever-password')).resolves.toBeUndefined();
  });
});
