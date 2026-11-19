import 'dotenv/config';
import { z } from 'zod';

/**
 * Every setting the backend reads from the environment is declared and validated here.
 * The process refuses to start if anything is missing or malformed, so a bad deploy
 * fails immediately instead of at the first request that needs the value.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Name of this process in logs and /health; distinguishes api-1 from api-2. */
  INSTANCE_ID: z.string().min(1).default('api-local'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  /** Comma-separated list of browser origins allowed to call the API. */
  CORS_ORIGINS: z.string().default('http://localhost:5174'),
  /** Number of reverse proxies in front of the app (0 = none, 1 = behind Nginx). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Must be true whenever the site is served over HTTPS. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v),
  /** Default 'strict' (same-origin Nginx/proxy). Use 'none' only with HTTPS cross-origin deploys. */
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),

  RATE_LIMIT_STORE: z.enum(['redis', 'memory']).default('redis'),

  /** Enables @socket.io/redis-adapter for cross-instance WebSocket broadcasting. */
  REDIS_ADAPTER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v),

  /** Optional Logstash TCP endpoint for ELK centralized structured logging. */
  LOGSTASH_HOST: z.string().trim().optional(),
  LOGSTASH_PORT: z.coerce.number().int().min(1).max(65535).default(5044),

  /** Directory on disk for uploaded attachments and avatars (outside any public webroot). */
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  /**
   * Where uploaded file bytes are kept: `disk` (UPLOAD_DIR) or `database` (PostgreSQL),
   * for hosts whose filesystem does not survive restarts. See storage.service.ts.
   */
  STORAGE_DRIVER: z.enum(['disk', 'database']).default('disk'),
  /**
   * Serve the built frontend from this directory (single-origin deployment). Unset in
   * development and Docker Compose, where Vite or Nginx serve the frontend.
   */
  FRONTEND_DIST: z.string().trim().min(1).optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  // Printed with console.error on purpose: the logger depends on this module.
  console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: [
    ...raw.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    // Render sets this to the service's own https:// URL; allow it without extra config.
    ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')] : []),
  ] as string[], // mutable array type: the `as const` below would make it readonly, which cors rejects
  /** Defaults to secure cookies in production and plain cookies for http://localhost. */
  cookieSecure: raw.COOKIE_SECURE ? raw.COOKIE_SECURE === 'true' : raw.NODE_ENV === 'production',
  /** Enabled by default outside test runs so multi-instance Socket.IO works out of the box. */
  redisAdapterEnabled: raw.REDIS_ADAPTER_ENABLED
    ? raw.REDIS_ADAPTER_ENABLED === 'true'
    : raw.NODE_ENV !== 'test',
} as const;

export type Env = typeof env;
