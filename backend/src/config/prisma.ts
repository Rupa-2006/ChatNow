import { PrismaClient } from '@prisma/client';

/**
 * One PrismaClient per process. Each client owns a connection pool, so creating one
 * per request would exhaust PostgreSQL's connection limit.
 */
export const prisma = new PrismaClient();
