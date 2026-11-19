import type { MessageType, Prisma } from '@prisma/client';
import { toAttachmentDto, type AttachmentDto } from './attachment.service.js';

export type MessageStatus = 'sent' | 'delivered' | 'read';

export type ReactionGroupDto = {
  emoji: string;
  userIds: string[];
};

export type MessageDto = {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  content: string;
  clientId: string;
  replyTo: {
    id: string;
    senderId: string;
    content: string;
    deleted: boolean;
  } | null;
  attachments: AttachmentDto[];
  reactions: ReactionGroupDto[];
  status: MessageStatus;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export const messageInclude = {
  replyTo: {
    select: { id: true, senderId: true, content: true, deletedAt: true },
  },
  attachments: {
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      width: true,
      height: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  reactions: {
    select: { emoji: true, userId: true },
    orderBy: { createdAt: 'asc' as const },
  },
  receipts: {
    select: { userId: true, deliveredAt: true, readAt: true },
  },
} satisfies Prisma.MessageInclude;

export type MessageRowWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function groupReactions(rows: { emoji: string; userId: string }[]): ReactionGroupDto[] {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const existing = map.get(r.emoji);
    if (existing) existing.push(r.userId);
    else map.set(r.emoji, [r.userId]);
  }
  return Array.from(map.entries()).map(([emoji, userIds]) => ({ emoji, userIds }));
}

export function deriveMessageStatus(
  receipts: { deliveredAt: Date | null; readAt: Date | null }[],
): MessageStatus {
  if (receipts.length === 0) return 'sent';
  if (receipts.every((r) => r.readAt !== null)) return 'read';
  if (receipts.every((r) => r.deliveredAt !== null || r.readAt !== null)) return 'delivered';
  return 'sent';
}

export function toMessageDto(row: MessageRowWithRelations): MessageDto {
  const isDeleted = row.deletedAt !== null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    type: row.type,
    content: isDeleted ? '' : row.content,
    clientId: row.clientId,
    replyTo: row.replyTo
      ? {
          id: row.replyTo.id,
          senderId: row.replyTo.senderId,
          content: row.replyTo.deletedAt ? '' : row.replyTo.content,
          deleted: row.replyTo.deletedAt !== null,
        }
      : null,
    attachments: isDeleted ? [] : row.attachments.map(toAttachmentDto),
    reactions: isDeleted ? [] : groupReactions(row.reactions),
    status: deriveMessageStatus(row.receipts),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function encodeTimestampCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeTimestampCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [iso, id] = raw.split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
