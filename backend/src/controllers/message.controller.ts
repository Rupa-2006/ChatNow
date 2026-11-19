import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/authenticate.js';
import * as messageService from '../services/message.service.js';
import { clientMeta } from '../utils/request.js';
import { conversationIdParamSchema } from '../validators/conversation.validators.js';
import {
  addReactionSchema,
  editMessageSchema,
  listMessagesQuerySchema,
  messageIdParamSchema,
  reactionParamsSchema,
  searchMessagesQuerySchema,
  sendMessageSchema,
} from '../validators/message.validators.js';

export async function list(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  const query = listMessagesQuerySchema.parse(req.query);
  const { messages, nextCursor } = await messageService.listMessages(requireAuth(req).userId, id, query);
  res.json({ data: messages, meta: { nextCursor } });
}

export async function send(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  const input = sendMessageSchema.parse(req.body);
  const { message, created } = await messageService.sendMessage(requireAuth(req).userId, id, input);
  res.status(created ? 201 : 200).json({ data: message });
}

export async function searchInConversation(req: Request, res: Response): Promise<void> {
  const { id } = conversationIdParamSchema.parse(req.params);
  const query = searchMessagesQuerySchema.parse(req.query);
  const { messages, nextCursor } = await messageService.searchConversationMessages(
    requireAuth(req).userId,
    id,
    query,
  );
  res.json({ data: messages, meta: { nextCursor } });
}

export async function searchAll(req: Request, res: Response): Promise<void> {
  const query = searchMessagesQuerySchema.parse(req.query);
  const { messages, nextCursor } = await messageService.searchAllMessages(requireAuth(req).userId, query);
  res.json({ data: messages, meta: { nextCursor } });
}

export async function edit(req: Request, res: Response): Promise<void> {
  const { id } = messageIdParamSchema.parse(req.params);
  const { content } = editMessageSchema.parse(req.body);
  res.json({ data: await messageService.editMessage(requireAuth(req).userId, id, content) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = messageIdParamSchema.parse(req.params);
  await messageService.deleteMessage(requireAuth(req).userId, id, clientMeta(req));
  res.status(204).end();
}

export async function addReaction(req: Request, res: Response): Promise<void> {
  const { id } = messageIdParamSchema.parse(req.params);
  const { emoji } = addReactionSchema.parse(req.body);
  res.json({ data: await messageService.addReaction(requireAuth(req).userId, id, emoji) });
}

export async function removeReaction(req: Request, res: Response): Promise<void> {
  const { id, emoji } = reactionParamsSchema.parse(req.params);
  res.json({ data: await messageService.removeReaction(requireAuth(req).userId, id, emoji) });
}
