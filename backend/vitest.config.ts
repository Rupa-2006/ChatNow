import 'dotenv/config';
import { defineConfig } from 'vitest/config';

/**
 * Tests never touch the development database. The test database URL is the one from
 * backend/.env with the database name swapped for "chatnow_test", and Redis logical
 * database 1 is used instead of 0.
 */
function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? 'postgresql://chatnow:chatnow@localhost:5434/chatnow';
  const url = new URL(base);
  url.pathname = '/chatnow_test';
  return url.toString();
}

function testRedisUrl(): string {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  url.pathname = '/1';
  return url.toString();
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    globalSetup: ['tests/globalSetup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl(),
      REDIS_URL: testRedisUrl(),
      // A fixed, test-only signing key. It protects nothing: it exists only inside the test run.
      JWT_ACCESS_SECRET: 'test-only-secret-test-only-secret-test-only-secret',
      RATE_LIMIT_STORE: 'memory',
      CORS_ORIGINS: 'http://localhost:5174',
      INSTANCE_ID: 'api-test',
    },
  },
});
