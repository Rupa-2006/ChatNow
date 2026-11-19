import type { Prisma } from '@prisma/client';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';

export type ClientMeta = { ip: string | null; userAgent: string | null };

export type AuditEntry = {
  action: string;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  meta?: ClientMeta;
  metadata?: Prisma.InputJsonObject;
};

/**
 * Writes a security-relevant event to two places: the AuditLog table (durable,
 * queryable by the application) and the structured log stream (shipped to ELK).
 *
 * Callers pass identifiers and reasons only — never passwords, tokens or message
 * content. A failure to write the audit row is logged but never fails the request.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  logger.info(
    {
      event: entry.action,
      audit: true,
      userId: entry.actorId ?? undefined,
      targetType: entry.targetType,
      targetId: entry.targetId,
      ip: entry.meta?.ip ?? undefined,
      ...entry.metadata,
    },
    entry.action,
  );
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ipAddress: entry.meta?.ip ?? null,
        userAgent: entry.meta?.userAgent ?? null,
        metadata: entry.metadata ?? {},
      },
    });
  } catch (err) {
    logger.error(
      { event: 'audit.write_failed', action: entry.action, err: { message: (err as Error).message } },
      'Failed to persist audit log entry',
    );
  }
}
