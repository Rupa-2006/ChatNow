import { redis } from '../config/redis.js';

/**
 * Lightweight Redis JSON cache for hot, read-heavy metadata (e.g. user directory profiles).
 * Never caches secrets or private message bodies. Always fails open to PostgreSQL if Redis
 * is momentarily unreachable.
 */
export async function getCachedJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCachedJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Cache writes are best-effort
  }
}

export async function deleteCachedKeys(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    // Ignore transient errors
  }
}

export const userProfileCacheKey = (userId: string) => `cache:user:${userId}`;
