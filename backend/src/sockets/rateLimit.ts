import { env } from '../config/env.js';
import { redis } from '../config/redis.js';

type BucketKind = 'message' | 'typing' | 'other';

const LIMITS: Record<BucketKind, { max: number; windowSec: number }> = {
  message: { max: 20, windowSec: 10 },
  typing: { max: 60, windowSec: 60 },
  other: { max: 120, windowSec: 60 },
};

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Per-user sliding/fixed-window rate limiter for Socket.IO events.
 * Uses Redis when RATE_LIMIT_STORE=redis so limits hold across multiple API instances,
 * and falls back cleanly to in-memory counters in unit/local test mode.
 */
export async function checkSocketRateLimit(
  userId: string,
  kind: BucketKind,
): Promise<{ allowed: boolean; remaining: number }> {
  const { max, windowSec } = LIMITS[kind];
  const key = `srl:${kind}:${userId}`;

  if (env.RATE_LIMIT_STORE === 'redis') {
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSec);
      }
      return { allowed: count <= max, remaining: Math.max(0, max - count) };
    } catch {
      // Fall through to in-memory limiter if Redis hiccups so abuse protection stays active.
    }
  }

  const now = Date.now();
  const entry = memoryBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: max - 1 };
  }
  entry.count += 1;
  return { allowed: entry.count <= max, remaining: Math.max(0, max - entry.count) };
}
