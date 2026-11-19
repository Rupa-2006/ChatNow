import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password.js';

/**
 * Creates demo accounts for local development. Safe to run repeatedly.
 * The password comes from SEED_USER_PASSWORD so no credential lives in source control.
 */
const DEMO_USERS = [
  { email: 'alice@chatnow.test', username: 'alice', displayName: 'Alice Johnson', bio: 'Product designer' },
  { email: 'bob@chatnow.test', username: 'bob', displayName: 'Bob Martinez', bio: 'Backend engineer' },
  { email: 'carol@chatnow.test', username: 'carol', displayName: 'Carol Nguyen', bio: 'Security analyst' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo users in production');
  }
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error('Set SEED_USER_PASSWORD (at least 10 characters) in backend/.env before seeding');
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    for (const user of DEMO_USERS) {
      await prisma.user.upsert({
        where: { email: user.email },
        update: {},
        create: { ...user, passwordHash },
      });
      console.log(`ready: ${user.username}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
