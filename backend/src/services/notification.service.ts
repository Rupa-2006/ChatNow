import type { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { emitToUser } from '../sockets/hub.js';
import { notFound } from '../utils/errors.js';

export type NotificationDto = {
  id: string;
  type: NotificationType;
  conversationId: string | null;
  messageId: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  type: NotificationType;
  conversationId: string | null;
  messageId: string | null;
  data: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
};

export function toNotificationDto(row: NotificationRow): NotificationDto {
  const data =
    row.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    type: row.type,
    conversationId: row.conversationId,
    messageId: row.messageId,
    data,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [iso, id] = raw.split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  conversationId?: string | null;
  messageId?: string | null;
  data?: Prisma.InputJsonObject;
}): Promise<NotificationDto> {
  const row = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      conversationId: params.conversationId ?? null,
      messageId: params.messageId ?? null,
      data: params.data ?? {},
    },
  });
  const dto = toNotificationDto(row);
  emitToUser(params.userId, 'notification:new', dto);
  return dto;
}

export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; limit: number; cursor?: string },
): Promise<{ notifications: NotificationDto[]; nextCursor: string | null; unreadCount: number }> {
  const parsedCursor = opts.cursor ? decodeCursor(opts.cursor) : null;

  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(opts.unreadOnly ? { readAt: null } : {}),
    ...(parsedCursor
      ? {
          OR: [
            { createdAt: { lt: parsedCursor.createdAt } },
            { createdAt: parsedCursor.createdAt, id: { lt: parsedCursor.id } },
          ],
        }
      : {}),
  };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    notifications: page.map(toNotificationDto),
    nextCursor: rows.length > opts.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    unreadCount,
  };
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<NotificationDto> {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!existing) throw notFound('Notification');

  if (existing.readAt) return toNotificationDto(existing);

  const updated = await prisma.notification.update({
    where: { id: existing.id },
    data: { readAt: new Date() },
  });
  return toNotificationDto(updated);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
