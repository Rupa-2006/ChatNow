import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';

export type Limiters = {
  /** Login and registration: slows password guessing and mass sign-ups. Per IP. */
  authStrict: RequestHandler;
  /** Token refresh. Per IP. */
  authRefresh: RequestHandler;
  /** Search endpoints, which are the most expensive queries. Per user. */
  search: RequestHandler;
  /** File and avatar uploads. Per user. */
  uploads: RequestHandler;
  /** Everything else behind authentication. Per user. */
  api: RequestHandler;
};

const passthrough: RequestHandler = (_req, _res, next) => next();

function make(name: string, windowMs: number, limit: number, perUser: boolean): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Counters live in Redis so the limit is shared by every API instance. With
    // in-memory counters a client could multiply its allowance by the number of
    // instances behind the load balancer.
    ...(env.RATE_LIMIT_STORE === 'redis'
      ? {
          store: new RedisStore({
            prefix: `rl:${name}:`,
            sendCommand: (command: string, ...args: string[]) =>
              redis.call(command, ...args) as Promise<RedisReply>,
          }),
        }
      : {}),
    keyGenerator: (req: Request) =>
      perUser && req.auth ? `u:${req.auth.userId}` : ipKeyGenerator(req.ip ?? ''),
    handler: (req: Request, res: Response) => {
      (req.log ?? logger).warn({ event: 'api.rate_limited', limiter: name }, 'Rate limit exceeded');
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again shortly.',
          requestId: String(req.id ?? ''),
        },
      });
    },
  });
}

const MINUTE = 60_000;

/** `enabled: false` is used by tests that are not about rate limiting. */
export function createLimiters(enabled: boolean): Limiters {
  if (!enabled) {
    return {
      authStrict: passthrough,
      authRefresh: passthrough,
      search: passthrough,
      uploads: passthrough,
      api: passthrough,
    };
  }
  return {
    authStrict: make('auth', 15 * MINUTE, 10, false),
    authRefresh: make('refresh', 15 * MINUTE, 60, false),
    search: make('search', MINUTE, 60, true),
    uploads: make('uploads', 10 * MINUTE, 20, true),
    api: make('api', MINUTE, 300, true),
  };
}
