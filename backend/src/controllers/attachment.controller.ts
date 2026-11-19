import { access } from 'node:fs/promises';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/authenticate.js';
import * as attachmentService from '../services/attachment.service.js';
import { notFound } from '../utils/errors.js';
import { clientMeta } from '../utils/request.js';
import { attachmentIdParamSchema } from '../validators/notification.validators.js';

export async function upload(req: Request, res: Response): Promise<void> {
  const dto = await attachmentService.uploadAttachment(requireAuth(req).userId, req.file, clientMeta(req));
  res.status(201).json({ data: dto });
}

export async function download(req: Request, res: Response): Promise<void> {
  const { id } = attachmentIdParamSchema.parse(req.params);
  const file = await attachmentService.getAuthorizedAttachment(requireAuth(req).userId, id);

  try {
    await access(file.filePath);
  } catch {
    throw notFound('Attachment');
  }

  const disposition = file.inline ? 'inline' : 'attachment';
  const encodedName = encodeURIComponent(file.originalName);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedName}`);
  res.sendFile(file.filePath);
}

export async function serveAvatar(req: Request, res: Response): Promise<void> {
  const filename = typeof req.params.filename === 'string' ? req.params.filename : '';
  const { filePath, mimeType } = attachmentService.resolveAvatarFile(filename);

  try {
    await access(filePath);
  } catch {
    throw notFound('Avatar');
  }

  res.setHeader('Content-Type', mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
}
