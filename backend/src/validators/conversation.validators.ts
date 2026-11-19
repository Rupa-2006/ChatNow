import { z } from 'zod';

export const conversationIdParamSchema = z.object({
  id: z.uuid('Invalid conversation id'),
});

export const memberParamsSchema = z.object({
  id: z.uuid('Invalid conversation id'),
  userId: z.uuid('Invalid user id'),
});

export const listConversationsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
});

export const createConversationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('DIRECT'),
    userId: z.uuid('Invalid user id'),
  }),
  z.object({
    type: z.literal('GROUP'),
    name: z.string().trim().min(1, 'Group name is required').max(80, 'Group name must be at most 80 characters'),
    memberIds: z
      .array(z.uuid('Invalid member id'))
      .min(1, 'Add at least one member')
      .max(100, 'Too many initial members'),
  }),
]);

export const updateConversationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Group name cannot be empty')
      .max(80, 'Group name must be at most 80 characters')
      .optional(),
    mutedUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.mutedUntil !== undefined, {
    message: 'Provide at least one field to update',
  });

export const addMembersSchema = z.object({
  userIds: z
    .array(z.uuid('Invalid user id'))
    .min(1, 'Select at least one user')
    .max(50, 'Cannot add more than 50 members at once'),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
});

export const markReadSchema = z.object({
  messageId: z.uuid('Invalid message id'),
});

export const listAttachmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
