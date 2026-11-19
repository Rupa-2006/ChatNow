import { z } from 'zod';
import { displayNameSchema, usernameSchema } from './auth.validators.js';

export const userIdParamSchema = z.object({ id: z.uuid('Invalid user id') });

export const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search for at least 2 characters').max(50),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    username: usernameSchema.optional(),
    bio: z.string().trim().max(280, 'Bio must be at most 280 characters').nullable().optional(),
    notificationPrefs: z
      .object({
        browser: z.boolean().optional(),
        sound: z.boolean().optional(),
        messagePreview: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
