import { execSync } from 'node:child_process';

/**
 * Runs once before the test run. When integration tests are included, applies the
 * migrations to the test database (Prisma creates the database if it is missing).
 * Unit-only runs skip this, so they need neither PostgreSQL nor Redis.
 */
export default function setup(): void {
  const args = process.argv.join(' ');
  const unitOnly = args.includes('tests/unit') && !args.includes('tests/integration');
  if (unitOnly) return;

  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://chatnow:chatnow@localhost:5434/chatnow');
  url.pathname = '/chatnow_test';

  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: url.toString() },
    });
  } catch (err) {
    const output = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    throw new Error(
      'Could not prepare the test database. Is Docker running?  ->  docker compose up -d\n' + output,
    );
  }
}
