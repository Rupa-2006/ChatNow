import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';

/**
 * Short-lived "this session was revoked" flags in Redis.
 *
 * Refresh tokens are revoked in PostgreSQL, but an access token already issued for
 * that session stays cryptographically valid until it expires. Each flag lives exactly
 * as long as the longest-lived access token could, after which it is no longer needed
 * and Redis deletes it — so the set never grows without bound.
 */
const key = (sessionId: string) => `revoked:session:${sessionId}`;

export async function flagSessionsRevoked(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  try {
    const pipeline = redis.pipeline();
    for (const id of sessionIds) pipeline.set(key(id), '1', 'EX', env.JWT_ACCESS_TTL_SECONDS);
    await pipeline.exec();
  } catch (err) {
    // The database revocation already succeeded, so the session cannot be refreshed.
    // Without the flag, an existing access token works for at most its remaining TTL.
    logger.warn(
      { event: 'auth.revocation_flag_failed', err: { message: (err as Error).message } },
      'Could not write session revocation flags to Redis',
    );
  }
}

export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  return (await redis.exists(key(sessionId))) === 1;
}
