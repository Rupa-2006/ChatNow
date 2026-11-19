import { Prisma, type ConversationType } from '@prisma/client';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { emitToConversation, emitToUser } from '../sockets/hub.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import type { SendMessageInput } from '../validators/message.validators.js';
import { audit, type ClientMeta } from './audit.service.js';
import { requireActiveMembership } from './conversation.service.js';
import {
  decodeTimestampCursor,
  encodeTimestampCursor,
  groupReactions,
  messageInclude,
  toMessageDto,
  type MessageDto,
} from './mappers.js';
import { createNotification } from './notification.service.js';
import { escapeLike, isBlockedEitherWay } from './user.service.js';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export async function listMessages(
  userId: string,
  conversationId: string,
  opts: { limit: number; cursor?: string; around?: string },
): Promise<{ messages: MessageDto[]; nextCursor: string | null }> {
  await requireActiveMembership(userId, conversationId);

  if (opts.around) {
    const target = await prisma.message.findFirst({
      where: { id: opts.around, conversationId },
      select: { id: true, createdAt: true },
    });
    if (!target) throw notFound('Message');

    const half = Math.max(1, Math.floor(opts.limit / 2));
    const [older, newer] = await Promise.all([
      prisma.message.findMany({
        where: {
          conversationId,
          OR: [
            { createdAt: { lt: target.createdAt } },
            { createdAt: target.createdAt, id: { lte: target.id } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: half + 1,
        include: messageInclude,
      }),
      prisma.message.findMany({
        where: {
          conversationId,
          OR: [
            { createdAt: { gt: target.createdAt } },
            { createdAt: target.createdAt, id: { gt: target.id } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: half,
        include: messageInclude,
      }),
    ]);

    const hasMoreOlder = older.length > half;
    const olderSlice = older.slice(0, half);
    // Combine newest-first to match normal endpoint ordering
    const combined = [...newer.reverse(), ...olderSlice];
    const oldest = olderSlice[olderSlice.length - 1];
    return {
      messages: combined.map(toMessageDto),
      nextCursor: hasMoreOlder && oldest ? encodeTimestampCursor(oldest.createdAt, oldest.id) : null,
    };
  }

  const parsed = opts.cursor ? decodeTimestampCursor(opts.cursor) : null;
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      ...(parsed
        ? {
            OR: [
              { createdAt: { lt: parsed.createdAt } },
              { createdAt: parsed.createdAt, id: { lt: parsed.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
    include: messageInclude,
  });

  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    messages: page.map(toMessageDto),
    nextCursor: rows.length > opts.limit && last ? encodeTimestampCursor(last.createdAt, last.id) : null,
  };
}

export async function sendMessage(
  userId: string,
  conversationId: string,
  input: SendMessageInput,
): Promise<{ message: MessageDto; created: boolean }> {
  const membership = await requireActiveMembership(userId, conversationId);

  // Idempotency check: a retried send with the same clientId returns the original message.
  const existing = await prisma.message.findUnique({
    where: { senderId_clientId: { senderId: userId, clientId: input.clientId } },
    include: messageInclude,
  });
  if (existing) {
    if (existing.conversationId !== conversationId) {
      throw badRequest('clientId already used in another conversation');
    }
    return { message: toMessageDto(existing), created: false };
  }

  // Load active members to verify block status (for DIRECT) and create receipts.
  const activeMembers = await prisma.conversationMember.findMany({
    where: { conversationId, leftAt: null },
    select: { userId: true, mutedUntil: true },
  });
  const recipients = activeMembers.filter((m) => m.userId !== userId);

  if (membership.conversation.type === 'DIRECT') {
    const other = recipients[0];
    if (other && (await isBlockedEitherWay(userId, other.userId))) {
      throw forbidden('Cannot send messages while a block is in place');
    }
  }

  if (input.replyToId) {
    const parent = await prisma.message.findFirst({
      where: { id: input.replyToId, conversationId },
      select: { id: true },
    });
    if (!parent) throw badRequest('Replied-to message does not belong to this conversation');
  }

  const attachmentIds = input.attachmentIds ? [...new Set(input.attachmentIds)] : [];
  if (attachmentIds.length > 0) {
    const owned = await prisma.attachment.findMany({
      where: { id: { in: attachmentIds }, uploaderId: userId, messageId: null },
      select: { id: true },
    });
    if (owned.length !== attachmentIds.length) {
      throw badRequest('One or more attachments are invalid or already attached');
    }
  }

  const messageType = attachmentIds.length > 0 && input.content.length === 0 ? 'FILE' : 'TEXT';

  try {
    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          conversationId,
          senderId: userId,
          type: messageType,
          content: input.content,
          clientId: input.clientId,
          replyToId: input.replyToId ?? null,
          receipts: {
            create: recipients.map((r) => ({ userId: r.userId })),
          },
        },
        select: { id: true, createdAt: true },
      });

      if (attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: { id: { in: attachmentIds }, uploaderId: userId, messageId: null },
          data: { messageId: msg.id },
        });
      }

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: msg.createdAt },
      });

      return tx.message.findUniqueOrThrow({
        where: { id: msg.id },
        include: messageInclude,
      });
    });

    const dto = toMessageDto(created);
    emitToConversation(conversationId, 'message:new', dto);

    // Log delivery metadata ONLY — never message content!
    logger.info({
      event: 'message.sent',
      userId,
      conversationId,
      messageId: dto.id,
      type: dto.type,
      attachmentCount: dto.attachments.length,
    });

    // Durable notifications for unmuted recipients (never storing raw message body in audit/logs;
    // notification data carries safe metadata so the UI can navigate to the thread).
    const now = Date.now();
    const sender = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, username: true },
    });

    await Promise.all(
      recipients
        .filter((r) => !r.mutedUntil || r.mutedUntil.getTime() <= now)
        .map((r) =>
          createNotification({
            userId: r.userId,
            type: 'NEW_MESSAGE',
            conversationId,
            messageId: dto.id,
            data: {
              senderId: userId,
              senderName: sender?.displayName ?? 'Someone',
              conversationType: membership.conversation.type,
              conversationName: membership.conversation.name,
            },
          }),
        ),
    );

    return { message: dto, created: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await prisma.message.findUnique({
        where: { senderId_clientId: { senderId: userId, clientId: input.clientId } },
        include: messageInclude,
      });
      if (raced) return { message: toMessageDto(raced), created: false };
    }
    throw err;
  }
}

export async function editMessage(
  userId: string,
  messageId: string,
  content: string,
): Promise<MessageDto> {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, senderId: true, createdAt: true, deletedAt: true },
  });
  if (!existing) throw notFound('Message');

  await requireActiveMembership(userId, existing.conversationId);

  if (existing.senderId !== userId) {
    throw forbidden('You can only edit your own messages');
  }
  if (existing.deletedAt) {
    throw badRequest('Deleted messages cannot be edited');
  }
  if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw forbidden('Messages can only be edited within 15 minutes of sending');
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content, editedAt: new Date() },
    include: messageInclude,
  });

  const dto = toMessageDto(updated);
  emitToConversation(existing.conversationId, 'message:updated', dto);
  return dto;
}

export async function deleteMessage(
  userId: string,
  messageId: string,
  meta: ClientMeta,
): Promise<{ conversationId: string; deletedAt: string }> {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, senderId: true, deletedAt: true },
  });
  if (!existing) throw notFound('Message');

  const membership = await requireActiveMembership(userId, existing.conversationId);

  const isOwn = existing.senderId === userId;
  const isGroupModerator =
    membership.conversation.type === 'GROUP' &&
    (membership.role === 'OWNER' || membership.role === 'ADMIN');

  if (!isOwn && !isGroupModerator) {
    throw forbidden('You do not have permission to delete this message');
  }

  const deletedAt = existing.deletedAt ?? new Date();
  if (!existing.deletedAt) {
    await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt, content: '' },
    });

    if (!isOwn) {
      await audit({
        action: 'message.deleted_by_admin',
        actorId: userId,
        targetType: 'message',
        targetId: messageId,
        meta,
        metadata: { conversationId: existing.conversationId, originalSenderId: existing.senderId },
      });
    }
  }

  const payload = {
    conversationId: existing.conversationId,
    messageId,
    deletedAt: deletedAt.toISOString(),
  };
  emitToConversation(existing.conversationId, 'message:deleted', payload);
  return { conversationId: existing.conversationId, deletedAt: payload.deletedAt };
}

export async function addReaction(userId: string, messageId: string, emoji: string): Promise<MessageDto> {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, deletedAt: true },
  });
  if (!existing) throw notFound('Message');

  await requireActiveMembership(userId, existing.conversationId);
  if (existing.deletedAt) throw badRequest('Cannot react to a deleted message');

  await prisma.messageReaction.upsert({
    where: { messageId_userId_emoji: { messageId, userId, emoji } },
    create: { messageId, userId, emoji },
    update: {},
  });

  const updated = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    include: messageInclude,
  });
  const dto = toMessageDto(updated);
  emitToConversation(existing.conversationId, 'message:reaction', {
    conversationId: existing.conversationId,
    messageId,
    reactions: groupReactions(updated.reactions),
  });
  return dto;
}

export async function removeReaction(userId: string, messageId: string, emoji: string): Promise<MessageDto> {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true },
  });
  if (!existing) throw notFound('Message');

  await requireActiveMembership(userId, existing.conversationId);

  await prisma.messageReaction.deleteMany({
    where: { messageId, userId, emoji },
  });

  const updated = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    include: messageInclude,
  });
  const dto = toMessageDto(updated);
  emitToConversation(existing.conversationId, 'message:reaction', {
    conversationId: existing.conversationId,
    messageId,
    reactions: groupReactions(updated.reactions),
  });
  return dto;
}

export async function markMessagesDelivered(userId: string, messageIds: string[]): Promise<number> {
  const uniqueIds = [...new Set(messageIds)];
  if (uniqueIds.length === 0) return 0;

  const pending = await prisma.messageReceipt.findMany({
    where: { userId, messageId: { in: uniqueIds }, deliveredAt: null },
    select: {
      id: true,
      messageId: true,
      message: { select: { senderId: true, conversationId: true } },
    },
  });
  if (pending.length === 0) return 0;

  const now = new Date();
  await prisma.messageReceipt.updateMany({
    where: { id: { in: pending.map((p) => p.id) }, deliveredAt: null },
    data: { deliveredAt: now },
  });

  // Group by (senderId, conversationId) so each sender gets batched receipt updates
  const grouped = new Map<string, { senderId: string; conversationId: string; messageIds: string[] }>();
  for (const r of pending) {
    const key = `${r.message.senderId}:${r.message.conversationId}`;
    const entry = grouped.get(key);
    if (entry) entry.messageIds.push(r.messageId);
    else {
      grouped.set(key, {
        senderId: r.message.senderId,
        conversationId: r.message.conversationId,
        messageIds: [r.messageId],
      });
    }
  }

  const atIso = now.toISOString();
  for (const g of grouped.values()) {
    emitToUser(g.senderId, 'receipt:update', {
      conversationId: g.conversationId,
      messageIds: g.messageIds,
      userId,
      status: 'delivered',
      at: atIso,
    });
    logger.info({
      event: 'message.delivered',
      userId,
      conversationId: g.conversationId,
      count: g.messageIds.length,
    });
  }

  return pending.length;
}

/** Called when a user connects over Socket.IO to mark all offline-queued messages delivered. */
export async function flushPendingDeliveries(userId: string): Promise<number> {
  const pending = await prisma.messageReceipt.findMany({
    where: { userId, deliveredAt: null },
    select: { messageId: true },
    take: 500,
  });
  if (pending.length === 0) return 0;
  return markMessagesDelivered(
    userId,
    pending.map((p) => p.messageId),
  );
}

export async function searchConversationMessages(
  userId: string,
  conversationId: string,
  opts: { q: string; limit: number; cursor?: string },
): Promise<{ messages: MessageDto[]; nextCursor: string | null }> {
  await requireActiveMembership(userId, conversationId);
  const parsed = opts.cursor ? decodeTimestampCursor(opts.cursor) : null;
  const ilike = `%${escapeLike(opts.q)}%`;

  const cursorClause = parsed
    ? Prisma.sql`AND (m."createdAt", m."id") < (${parsed.createdAt}, ${parsed.id}::uuid)`
    : Prisma.empty;

  const ids = await prisma.$queryRaw<{ id: string; createdAt: Date }[]>(Prisma.sql`
    SELECT m."id", m."createdAt"
    FROM "Message" m
    WHERE m."conversationId" = ${conversationId}::uuid
      AND m."deletedAt" IS NULL
      AND (
        to_tsvector('simple', m."content") @@ websearch_to_tsquery('simple', ${opts.q})
        OR m."content" ILIKE ${ilike}
      )
      ${cursorClause}
    ORDER BY m."createdAt" DESC, m."id" DESC
    LIMIT ${opts.limit + 1}
  `);

  const pageIds = ids.slice(0, opts.limit);
  const last = pageIds[pageIds.length - 1];
  if (pageIds.length === 0) return { messages: [], nextCursor: null };

  const rows = await prisma.message.findMany({
    where: { id: { in: pageIds.map((r) => r.id) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: messageInclude,
  });

  return {
    messages: rows.map(toMessageDto),
    nextCursor: ids.length > opts.limit && last ? encodeTimestampCursor(last.createdAt, last.id) : null,
  };
}

export type GlobalMessageHit = MessageDto & {
  conversation: { id: string; name: string | null; type: ConversationType };
};

export async function searchAllMessages(
  userId: string,
  opts: { q: string; limit: number; cursor?: string },
): Promise<{ messages: GlobalMessageHit[]; nextCursor: string | null }> {
  const parsed = opts.cursor ? decodeTimestampCursor(opts.cursor) : null;
  const ilike = `%${escapeLike(opts.q)}%`;

  const cursorClause = parsed
    ? Prisma.sql`AND (m."createdAt", m."id") < (${parsed.createdAt}, ${parsed.id}::uuid)`
    : Prisma.empty;

  // Authorization is built directly into the JOIN: only conversations where userId is an active member.
  const ids = await prisma.$queryRaw<{ id: string; createdAt: Date }[]>(Prisma.sql`
    SELECT m."id", m."createdAt"
    FROM "Message" m
    INNER JOIN "ConversationMember" cm
      ON cm."conversationId" = m."conversationId"
     AND cm."userId" = ${userId}::uuid
     AND cm."leftAt" IS NULL
    WHERE m."deletedAt" IS NULL
      AND (
        to_tsvector('simple', m."content") @@ websearch_to_tsquery('simple', ${opts.q})
        OR m."content" ILIKE ${ilike}
      )
      ${cursorClause}
    ORDER BY m."createdAt" DESC, m."id" DESC
    LIMIT ${opts.limit + 1}
  `);

  const pageIds = ids.slice(0, opts.limit);
  const last = pageIds[pageIds.length - 1];
  if (pageIds.length === 0) return { messages: [], nextCursor: null };

  const rows = await prisma.message.findMany({
    where: { id: { in: pageIds.map((r) => r.id) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      ...messageInclude,
      conversation: { select: { id: true, name: true, type: true } },
    },
  });

  return {
    messages: rows.map((row) => ({
      ...toMessageDto(row),
      conversation: row.conversation,
    })),
    nextCursor: ids.length > opts.limit && last ? encodeTimestampCursor(last.createdAt, last.id) : null,
  };
}
