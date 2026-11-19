import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { attachSocketServer, type AttachedSocketServer } from './sockets/index.js';

const app = createApp();
const server = createServer(app);
let socketServer: AttachedSocketServer | null = null;

async function start(): Promise<void> {
  socketServer = await attachSocketServer(server);
  server.listen(env.PORT, () => {
    logger.info(
      { event: 'server.started', port: env.PORT, redisAdapter: env.redisAdapterEnabled },
      `ChatNow API + Socket.IO listening on port ${env.PORT}`,
    );
  });
}

void start().catch((err) => {
  logger.fatal({ event: 'server.startup_failed', err }, 'Failed to start ChatNow server');
  process.exit(1);
});

/**
 * Graceful shutdown: stop accepting connections, close Socket.IO + Redis adapter,
 * let in-flight requests finish, then close PostgreSQL and Redis.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: 'server.stopping', signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error({ event: 'server.forced_exit' }, 'Shutdown timed out; exiting');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  await socketServer?.close().catch(() => {});
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    logger.info({ event: 'server.stopped' }, 'Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'process.unhandled_rejection', err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ event: 'process.uncaught_exception', err }, 'Uncaught exception');
  process.exit(1);
});
