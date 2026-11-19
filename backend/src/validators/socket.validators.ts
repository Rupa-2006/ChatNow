import { z } from 'zod';

export const socketSendMessageSchema = z
  .object({
    conversationId: z.uuid('Invalid conversation id'),
    content: z.string().trim().max(4000, 'Message must be at most 4000 characters').default(''),
    clientId: z.uuid('clientId must be a valid UUID'),
    replyToId: z.uuid('Invalid replyToId').optional().nullable(),
    attachmentIds: z.array(z.uuid('Invalid attachment id')).max(10).optional(),
  })
  .refine((v) => v.content.length > 0 || (v.attachmentIds !== undefined && v.attachmentIds.length > 0), {
    message: 'Message content or at least one attachment is required',
  });

export const socketEditMessageSchema = z.object({
  messageId: z.uuid('Invalid message id'),
  content: z.string().trim().min(1).max(4000),
});

export const socketDeleteMessageSchema = z.object({
  messageId: z.uuid('Invalid message id'),
});

export const socketReactMessageSchema = z.object({
  messageId: z.uuid('Invalid message id'),
  emoji: z.string().trim().min(1).max(32),
  remove: z.boolean().optional(),
});

export const socketDeliveredSchema = z.object({
  messageIds: z.array(z.uuid('Invalid message id')).min(1).max(100),
});

export const socketConversationReadSchema = z.object({
  conversationId: z.uuid('Invalid conversation id'),
  messageId: z.uuid('Invalid message id'),
});

export const socketTypingSchema = z.object({
  conversationId: z.uuid('Invalid conversation id'),
});

export const socketPresenceSubscribeSchema = z.object({
  userIds: z.array(z.uuid('Invalid user id')).max(200),
});

export const socketAuthRefreshSchema = z.object({
  token: z.string().min(10).max(4096),
});
