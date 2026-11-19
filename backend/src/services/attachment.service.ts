import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { prisma } from '../config/prisma.js';
import { badRequest, notFound, unsupportedMediaType } from '../utils/errors.js';
import { isAllowedAvatarMime, sanitizeFilename, sniffFileContent } from '../utils/fileSniff.js';
import { audit, type ClientMeta } from './audit.service.js';
import { storage } from './storage.service.js';
import { deleteCachedKeys, userProfileCacheKey } from './cache.service.js';
import { meSelect, toMe, type Me } from './user.service.js';

export type AttachmentDto = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string;
};

type AttachmentRow = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

export function toAttachmentDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    url: `/api/attachments/${row.id}/download`,
  };
}

async function persistFile(subDir: 'files' | 'avatars', ext: string, buffer: Buffer, mimeType: string): Promise<string> {
  // Random server-generated name: nothing from the uploader's filename reaches storage.
  const key = `${subDir}/${randomUUID()}${ext}`;
  await storage.put(key, buffer, mimeType);
  return key;
}

export async function uploadAttachment(
  userId: string,
  file: Express.Multer.File | undefined,
  meta: ClientMeta,
): Promise<AttachmentDto> {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw badRequest('No file provided');
  }

  const sniffed = sniffFileContent(file.buffer, file.originalname);
  if (!sniffed) {
    throw unsupportedMediaType('File type is not allowed. Supported: images, PDF, text, Office documents, ZIP.');
  }

  const storageKey = await persistFile('files', sniffed.extension, file.buffer, sniffed.mimeType);
  const originalName = sanitizeFilename(file.originalname);

  const row = await prisma.attachment.create({
    data: {
      uploaderId: userId,
      originalName,
      storageKey,
      mimeType: sniffed.mimeType,
      sizeBytes: file.buffer.length,
      width: sniffed.width,
      height: sniffed.height,
    },
  });

  await audit({
    action: 'attachment.uploaded',
    actorId: userId,
    targetType: 'attachment',
    targetId: row.id,
    meta,
    metadata: { mimeType: row.mimeType, sizeBytes: row.sizeBytes },
  });

  return toAttachmentDto(row);
}

export async function uploadUserAvatar(
  userId: string,
  file: Express.Multer.File | undefined,
  meta: ClientMeta,
): Promise<Me> {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw badRequest('No image provided');
  }

  const sniffed = sniffFileContent(file.buffer, file.originalname);
  if (!sniffed || !isAllowedAvatarMime(sniffed.mimeType)) {
    throw unsupportedMediaType('Avatar must be a valid JPEG, PNG, or WebP image.');
  }

  const storageKey = await persistFile('avatars', sniffed.extension, file.buffer, sniffed.mimeType);
  const avatarFile = path.basename(storageKey);
  const avatarUrl = `/api/avatars/${avatarFile}`;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
    select: meSelect,
  });
  await deleteCachedKeys(userProfileCacheKey(userId));

  await audit({
    action: 'user.avatar.updated',
    actorId: userId,
    targetType: 'user',
    targetId: userId,
    meta,
    metadata: { mimeType: sniffed.mimeType, sizeBytes: file.buffer.length },
  });

  return toMe(updated);
}

export async function storeAvatarFile(file: Express.Multer.File | undefined): Promise<{ avatarUrl: string; mimeType: string; sizeBytes: number }> {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw badRequest('No image provided');
  }

  const sniffed = sniffFileContent(file.buffer, file.originalname);
  if (!sniffed || !isAllowedAvatarMime(sniffed.mimeType)) {
    throw unsupportedMediaType('Avatar must be a valid JPEG, PNG, or WebP image.');
  }

  const storageKey = await persistFile('avatars', sniffed.extension, file.buffer, sniffed.mimeType);
  return {
    avatarUrl: `/api/avatars/${path.basename(storageKey)}`,
    mimeType: sniffed.mimeType,
    sizeBytes: file.buffer.length,
  };
}

const AVATAR_KEY_RE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i;

export function resolveAvatarFile(filename: string): { storageKey: string; mimeType: string } {
  if (!AVATAR_KEY_RE.test(filename)) throw notFound('Avatar');
  const ext = path.extname(filename).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { storageKey: `avatars/${filename}`, mimeType };
}

/**
 * Authorizes attachment download:
 * - If attached to a message, caller must be an active member of that message's conversation.
 * - If still unattached, only the uploader may download it.
 */
export async function getAuthorizedAttachment(
  userId: string,
  attachmentId: string,
): Promise<{
  storageKey: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  inline: boolean;
}> {
  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: {
      message: {
        select: { conversationId: true, deletedAt: true, createdAt: true },
      },
    },
  });

  if (!row) throw notFound('Attachment');

  if (row.message) {
    if (row.message.deletedAt) throw notFound('Attachment');
    const membership = await prisma.conversationMember.findFirst({
      where: { conversationId: row.message.conversationId, userId, leftAt: null },
      select: { joinedAt: true },
    });
    // Members can only download files shared during their current membership.
    if (!membership || row.message.createdAt < membership.joinedAt) throw notFound('Attachment');
  } else if (row.uploaderId !== userId) {
    throw notFound('Attachment');
  }

  const isInlineImage = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(row.mimeType);
  return {
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    originalName: row.originalName,
    sizeBytes: row.sizeBytes,
    inline: isInlineImage,
  };
}
