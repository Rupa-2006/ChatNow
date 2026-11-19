import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { redis } from '../config/redis.js';

const TIMEOUT_MS = 2000;

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
