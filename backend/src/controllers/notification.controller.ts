import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/authenticate.js';
import * as notificationService from '../services/notification.service.js';
import { listNotificationsQuerySchema, notificationIdParamSchema } from '../validators/notification.validators.js';

export async function list(req: Request, res: Response): Promise<void> {
  const query = listNotificationsQuerySchema.parse(req.query);
  const { notifications, nextCursor, unreadCount } = await notificationService.listNotifications(
    requireAuth(req).userId,
    query,
  );
  res.json({ data: notifications, meta: { nextCursor, unreadCount } });
}

export async function markRead(req: Request, res: Response): Promise<void> {
  const { id } = notificationIdParamSchema.parse(req.params);
  res.json({ data: await notificationService.markNotificationRead(requireAuth(req).userId, id) });
}

export async function markAllRead(req: Request, res: Response): Promise<void> {
  await notificationService.markAllNotificationsRead(requireAuth(req).userId);
  res.status(204).end();
}
