import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { redis } from '../config/redis.js';

// How long each dependency may take to answer. The first database query after a few
// idle minutes can take about 2 s through Docker Desktop's port forwarding on Windows
// (measured 2.06 s), which a 2 s limit misreported as "database down" although every
// real request succeeded. 4 s tolerates that and stays under the Docker HEALTHCHECK's
// own 5 s timeout, so a genuinely unreachable database is still reported.
const TIMEOUT_MS = 4000;

async function check(probe: () => Promise<unknown>): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Used by Docker, Nginx and hosting platforms to decide whether this instance should
 * receive traffic. 503 when a dependency is unreachable.
 */
export async function health(_req: Request, res: Response): Promise<void> {
  const [database, redisState] = await Promise.all([
    check(() => prisma.$queryRaw`SELECT 1`),
    check(() => redis.ping()),
  ]);
  const ok = database === 'up' && redisState === 'up';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    instance: env.INSTANCE_ID,
    uptime: Math.round(process.uptime()),
    checks: { database, redis: redisState },
  });
}
