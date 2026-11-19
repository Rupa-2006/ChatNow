import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/authenticate.js';
import * as attachmentService from '../services/attachment.service.js';
import * as userService from '../services/user.service.js';
import { clientMeta } from '../utils/request.js';
import {
  listUsersQuerySchema,
  searchUsersQuerySchema,
  updateProfileSchema,
  userIdParamSchema,
} from '../validators/user.validators.js';

export async function list(req: Request, res: Response): Promise<void> {
  const query = listUsersQuerySchema.parse(req.query);
  const { users, nextCursor } = await userService.listUsers(requireAuth(req).userId, query);
  res.json({ data: users, meta: { nextCursor } });
}

export async function search(req: Request, res: Response): Promise<void> {
  const { q, limit } = searchUsersQuerySchema.parse(req.query);
  res.json({ data: await userService.searchUsers(requireAuth(req).userId, q, limit) });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const { id } = userIdParamSchema.parse(req.params);
  res.json({ data: await userService.getUser(requireAuth(req).userId, id) });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const input = updateProfileSchema.parse(req.body);
  res.json({ data: await userService.updateProfile(requireAuth(req).userId, input, clientMeta(req)) });
}

export async function uploadAvatar(req: Request, res: Response): Promise<void> {
  res.json({ data: await attachmentService.uploadUserAvatar(requireAuth(req).userId, req.file, clientMeta(req)) });
}

export async function listBlocks(req: Request, res: Response): Promise<void> {
  res.json({ data: await userService.listBlockedUsers(requireAuth(req).userId) });
}

export async function block(req: Request, res: Response): Promise<void> {
  const { id } = userIdParamSchema.parse(req.params);
  await userService.blockUser(requireAuth(req).userId, id, clientMeta(req));
  res.status(204).end();
}

export async function unblock(req: Request, res: Response): Promise<void> {
  const { id } = userIdParamSchema.parse(req.params);
  await userService.unblockUser(requireAuth(req).userId, id, clientMeta(req));
  res.status(204).end();
}
