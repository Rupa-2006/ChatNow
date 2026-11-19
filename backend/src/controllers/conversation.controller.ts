import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/authenticate.js';
import * as attachmentService from '../services/attachment.service.js';
import * as conversationService from '../services/conversation.service.js';
import { clientMeta } from '../utils/request.js';
import {
  addMembersSchema,
  conversationIdParamSchema,
  createConversationSchema,
  listAttachmentsQuerySchema,
  listConversationsQuerySchema,
  markReadSchema,
  memberParamsSchema,
  updateConversationSchema,
  updateMemberRoleSchema,
} from '../validators/conversation.validators.js';

export async function list(req: Request, res: Response): Promise<void> {
  const { q } = listConversationsQuerySchema.parse(req.query);
  res.json({ data: await conversationService.listConversations(requireAuth(req).userId, q) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = createConversationSchema.parse(req.body);
  const { conversation, created } = await conversationService.createConversation(
    requireAuth(req).userId,
    input,
    clientMeta(req),
  );
  res.status(created ? 201 : 200).json({ data: conversation });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  res.json({ data: await conversationService.getConversationForViewer(requireAuth(req).userId, id) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  const input = updateConversationSchema.parse(req.body);
  res.json({
    data: await conversationService.updateConversation(requireAuth(req).userId, id, input, clientMeta(req)),
  });
}

export async function uploadAvatar(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  const { userId } = requireAuth(req);
  // Enforce OWNER/ADMIN RBAC strictly BEFORE writing any file bytes to disk
  await conversationService.assertCanManageGroup(userId, id);
  const stored = await attachmentService.storeAvatarFile(req.file);
  const updated = await conversationService.updateConversationAvatar(userId, id, stored.avatarUrl, clientMeta(req));
  res.json({ data: updated });
}

export async function addMembers(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  const { userIds } = addMembersSchema.parse(req.body);
  res.json({
    data: await conversationService.addGroupMembers(requireAuth(req).userId, id, userIds, clientMeta(req)),
  });
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  const { id, userId: targetUserId } = memberParamsSchema.parse(req.params);
  await conversationService.removeGroupMember(requireAuth(req).userId, id, targetUserId, clientMeta(req));
  res.status(204).end();
}

export async function updateMemberRole(req: Request, res: Response): Promise<void> {
  const { id, userId: targetUserId } = memberParamsSchema.parse(req.params);
  const { role } = updateMemberRoleSchema.parse(req.body);
  res.json({
    data: await conversationService.updateMemberRole(
      requireAuth(req).userId,
      id,
      targetUserId,
      role,
      clientMeta(req),
    ),
  });
}

export async function leave(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  await conversationService.leaveGroup(requireAuth(req).userId, id, clientMeta(req));
  res.status(204).end();
}

export async function markRead(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  const { messageId } = markReadSchema.parse(req.body);
  await conversationService.markConversationRead(requireAuth(req).userId, id, messageId);
  res.status(204).end();
}

export async function listAttachments(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  const query = listAttachmentsQuerySchema.parse(req.query);
  const { attachments, nextCursor } = await conversationService.listConversationAttachments(
    requireAuth(req).userId,
    id,
    query,
  );
  res.json({ data: attachments, meta: { nextCursor } });
}
