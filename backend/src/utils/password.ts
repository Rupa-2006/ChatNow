import argon2 from 'argon2';

/**
 * Argon2id with OWASP's recommended minimum parameters (19 MiB memory, 2 iterations,
 * 1 lane). Argon2 is "memory-hard": each guess needs that much RAM, which is what
 * makes large-scale GPU cracking of a leaked database expensive.
 * The salt is generated per password and stored inside the hash string.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed stored hash must read as "wrong password", not crash the login route.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real verification. Called when the account does not
 * exist, so response time does not reveal which usernames are registered.
 */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummyHash ??= hashPassword('chatnow-timing-equaliser');
  await verifyPassword(await dummyHash, plain);
}
