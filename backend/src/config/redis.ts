import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * General-purpose Redis connection (presence, revocation flags, rate-limit counters).
 *
 * `lazyConnect` means nothing is opened until the first command, so importing this
 * module (e.g. in unit tests) never requires a running Redis.
 * `maxRetriesPerRequest` bounds how long a command waits when Redis is down, so
 * requests fail fast instead of hanging.
 */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
});

let lastErrorLoggedAt = 0;
redis.on('error', (err) => {
  // ioredis emits an error on every failed reconnect attempt; log at most every 10 s.
  const now = Date.now();
  if (now - lastErrorLoggedAt > 10_000) {
    lastErrorLoggedAt = now;
    // A refused connection arrives as an AggregateError with an empty message, so fall back to its code.
    const reason = err.message || (err as NodeJS.ErrnoException).code || err.name;
    logger.error({ event: 'redis.error', reason }, 'Redis connection error');
  }
});
redis.on('ready', () => logger.info({ event: 'redis.ready' }, 'Redis connected'));
