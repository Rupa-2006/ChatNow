import { randomUUID } from 'node:crypto';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { mountFrontend } from './frontend.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createLimiters } from './middleware/rateLimit.js';
import { buildApiRouter } from './routes/index.js';

export type AppOptions = {
  /** Tests that are not about rate limiting turn it off. Defaults to on. */
  rateLimit?: boolean;
  /** Serve the built frontend from this directory. Defaults to FRONTEND_DIST. */
  frontendDist?: string;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Builds the Express application without starting a server, so tests can drive it
 * directly with Supertest.
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  // How many proxies to trust for X-Forwarded-For. Trusting more than really exist
  // would let a client spoof its IP and dodge rate limits.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      // Reuse a well-formed id from the proxy so one request can be traced end to end;
      // otherwise mint one. It is returned in a header and in every error body.
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customProps: (req) => {
        const auth = (req as express.Request).auth;
        return { event: 'api.request', userId: auth?.userId };
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      serializers: {
        // Log the path without the query string: search terms are user data.
        req: (req: { id: unknown; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
          remoteAddress: req.remoteAddress,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Secure headers. The API only ever returns JSON and files, so its Content Security
  // Policy can forbid everything. When this process also serves the website
  // (FRONTEND_DIST), the pages get their own policy in frontend.ts.
  const apiHeaders = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });
  const frontendDist = options.frontendDist ?? env.FRONTEND_DIST;
  if (frontendDist) app.use('/api', apiHeaders);
  else app.use(apiHeaders);

  // Only the listed origins may read responses, and only they may send the cookie.
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', buildApiRouter(createLimiters(options.rateLimit ?? true)));

  if (frontendDist) mountFrontend(app, path.resolve(frontendDist));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
