import { z } from 'zod';

export const notificationIdParamSchema = z.object({
  id: z.uuid('Invalid notification id'),
});

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

export const attachmentIdParamSchema = z.object({
  id: z.uuid('Invalid attachment id'),
});
