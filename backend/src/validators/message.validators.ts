import { z } from 'zod';

export const messageIdParamSchema = z.object({
  id: z.uuid('Invalid message id'),
});

export const reactionParamsSchema = z.object({
  id: z.uuid('Invalid message id'),
  emoji: z.string().trim().min(1).max(32),
});

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
  around: z.uuid('Invalid message id').optional(),
});

export const sendMessageSchema = z
  .object({
    content: z.string().trim().max(4000, 'Message must be at most 4000 characters').default(''),
    clientId: z.uuid('clientId must be a valid UUID'),
    replyToId: z.uuid('Invalid replyToId').optional().nullable(),
    attachmentIds: z.array(z.uuid('Invalid attachment id')).max(10, 'At most 10 attachments per message').optional(),
  })
  .refine((v) => v.content.length > 0 || (v.attachmentIds !== undefined && v.attachmentIds.length > 0), {
    message: 'Message content or at least one attachment is required',
    path: ['content'],
  });

export const editMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(4000, 'Message must be at most 4000 characters'),
});

export const addReactionSchema = z.object({
  emoji: z.string().trim().min(1, 'Emoji is required').max(32, 'Emoji is too long'),
});

export const searchMessagesQuerySchema = z.object({
  q: z.string().trim().min(1, 'Enter a search query').max(120, 'Search query is too long'),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().max(200).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
