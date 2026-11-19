import { Prisma, type ConversationType, type MemberRole } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import {
  emitToConversation,
  emitToUser,
  joinUserToConversationRoom,
  removeUserFromConversationRoom,
} from '../sockets/hub.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import type { CreateConversationInput, UpdateConversationInput } from '../validators/conversation.validators.js';
import { toAttachmentDto, type AttachmentDto } from './attachment.service.js';
import { audit, type ClientMeta } from './audit.service.js';
import {
  decodeTimestampCursor,
  encodeTimestampCursor,
  isVisibleTo,
  messageInclude,
  toMessageDto,
  type MessageDto,
} from './mappers.js';
import { createNotification } from './notification.service.js';
import { isBlockedEitherWay, publicUserSelect, toPublicUsers, type PublicUser } from './user.service.js';

export type MemberDto = {
  user: PublicUser;
  role: MemberRole;
  joinedAt: string;
};

export type ConversationDto = {
  id: string;
  type: ConversationType;
  name: string | null;
  avatarUrl: string | null;
  members: MemberDto[];
  lastMessage: MessageDto | null;
  unreadCount: number;
  mutedUntil: string | null;
  myRole: MemberRole;
  createdAt: string;
  lastMessageAt: string | null;
};

export function makeDirectKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export async function assertCanManageGroup(userId: string, conversationId: string): Promise<void> {
  const membership = await requireActiveMembership(userId, conversationId);
  if (membership.conversation.type !== 'GROUP') {
    throw badRequest('Direct conversations do not support group management');
  }
  if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
    throw forbidden('Only group owners and admins can perform this action');
  }
}

export async function requireActiveMembership(userId: string, conversationId: string) {
  const member = await prisma.conversationMember.findFirst({
    where: { conversationId, userId, leftAt: null },
    include: {
      conversation: {
        select: { id: true, type: true, name: true, avatarUrl: true, directKey: true },
      },
    },
  });
  // Intentionally 404 (not 403) so non-members cannot probe whether a conversation ID exists.
  if (!member) throw notFound('Conversation');
  return member;
}

const conversationFullInclude = {
  members: {
    where: { leftAt: null },
    orderBy: { joinedAt: 'asc' as const },
    include: {
      user: { select: publicUserSelect },
    },
  },
  messages: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    include: messageInclude,
  },
} satisfies Prisma.ConversationInclude;

type ConversationFullRow = Prisma.ConversationGetPayload<{ include: typeof conversationFullInclude }>;

async function hydrateConversations(viewerId: string, rows: ConversationFullRow[]): Promise<ConversationDto[]> {
  if (rows.length === 0) return [];

  // Collect all unique users across all conversations for a single presence + block query.
  const rawUsersMap = new Map<string, (typeof rows)[number]['members'][number]['user']>();
  for (const conv of rows) {
    for (const m of conv.members) {
      rawUsersMap.set(m.user.id, m.user);
    }
  }
  const hydratedUsers = await toPublicUsers(viewerId, Array.from(rawUsersMap.values()));
  const userById = new Map(hydratedUsers.map((u) => [u.id, u]));

  // Compute unread counts per conversation for viewerId in one grouped query.
  const convIds = rows.map((r) => r.id);
  // The viewer only sees messages from their current membership onwards (see
  // message.service.ts), so previews and unread counts must ignore anything earlier.
  const joinedAtByConv = new Map<string, Date>();
  for (const conv of rows) {
    const mine = conv.members.find((m) => m.userId === viewerId);
    if (mine) joinedAtByConv.set(conv.id, mine.joinedAt);
  }

  const unreadRows = await prisma.messageReceipt.findMany({
    where: {
      userId: viewerId,
      readAt: null,
      message: { conversationId: { in: convIds }, deletedAt: null },
    },
    select: { message: { select: { conversationId: true, createdAt: true } } },
  });
  const unreadByConv = new Map<string, number>();
  for (const r of unreadRows) {
    const cid = r.message.conversationId;
    if (!isVisibleTo(r.message.createdAt, joinedAtByConv.get(cid))) continue;
    unreadByConv.set(cid, (unreadByConv.get(cid) ?? 0) + 1);
  }

  return rows.map((conv) => {
    const myMembership = conv.members.find((m) => m.userId === viewerId);
    const since = myMembership?.joinedAt;
    // Only the newest message is loaded; if the viewer cannot see it, they cannot see any.
    const newest = conv.messages[0];
    const lastMsg = newest && isVisibleTo(newest.createdAt, since) ? toMessageDto(newest, since) : null;
    return {
      id: conv.id,
      type: conv.type,
      name: conv.name,
      avatarUrl: conv.avatarUrl,
      members: conv.members.map((m) => ({
        user: userById.get(m.userId) ?? {
          id: m.user.id,
          username: m.user.username,
          displayName: m.user.displayName,
          avatarUrl: m.user.avatarUrl,
          bio: m.user.bio,
          isOnline: false,
          lastSeenAt: null,
        },
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      })),
      lastMessage: lastMsg,
      unreadCount: unreadByConv.get(conv.id) ?? 0,
      mutedUntil: myMembership?.mutedUntil?.toISOString() ?? null,
      myRole: myMembership?.role ?? 'MEMBER',
      createdAt: conv.createdAt.toISOString(),
      // Do not reveal when hidden activity happened: report the visible message's time.
      lastMessageAt: lastMsg ? (conv.lastMessageAt?.toISOString() ?? null) : null,
    };
  });
}

/**
 * Group fields that are the same for every member. `conversation:updated` is
 * broadcast to the whole room, so it must not carry the actor's personal fields
 * (role, unread count, mute state, last-message preview): recipients used to
 * overwrite their own with them, e.g. a member appearing as ADMIN after an admin
 * renamed the group.
 */
export function sharedConversationFields(conv: ConversationDto) {
  return { id: conv.id, type: conv.type, name: conv.name, avatarUrl: conv.avatarUrl, members: conv.members };
}

export async function getConversationForViewer(viewerId: string, conversationId: string): Promise<ConversationDto> {
  await requireActiveMembership(viewerId, conversationId);
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: conversationFullInclude,
  });
  if (!row) throw notFound('Conversation');
  const [dto] = await hydrateConversations(viewerId, [row]);
  if (!dto) throw notFound('Conversation');
  return dto;
}

export async function listConversations(userId: string, q?: string): Promise<ConversationDto[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      members: { some: { userId, leftAt: null } },
    },
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    include: conversationFullInclude,
  });

  const dtos = await hydrateConversations(userId, rows);
  const filter = q?.trim().toLowerCase();
  if (!filter) return dtos;

  return dtos.filter((conv) => {
    if (conv.name && conv.name.toLowerCase().includes(filter)) return true;
    return conv.members.some(
      (m) =>
        m.user.id !== userId &&
        (m.user.displayName.toLowerCase().includes(filter) || m.user.username.toLowerCase().includes(filter)),
    );
  });
}

export async function createConversation(
  userId: string,
  input: CreateConversationInput,
  meta: ClientMeta,
): Promise<{ conversation: ConversationDto; created: boolean }> {
  if (input.type === 'DIRECT') {
    if (input.userId === userId) {
      throw badRequest('You cannot start a direct conversation with yourself');
    }
    const target = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!target) throw notFound('User');

    if (await isBlockedEitherWay(userId, input.userId)) {
      throw forbidden('You cannot message this user because a block is in place');
    }

    const directKey = makeDirectKey(userId, input.userId);
    const existing = await prisma.conversation.findUnique({
      where: { directKey },
      select: { id: true },
    });
    if (existing) {
      return { conversation: await getConversationForViewer(userId, existing.id), created: false };
    }

    try {
      const created = await prisma.conversation.create({
        data: {
          type: 'DIRECT',
          directKey,
          createdById: userId,
          members: {
            create: [
              { userId, role: 'MEMBER' },
              { userId: input.userId, role: 'MEMBER' },
            ],
          },
        },
        select: { id: true },
      });

      await Promise.all([
        joinUserToConversationRoom(userId, created.id),
        joinUserToConversationRoom(input.userId, created.id),
      ]);

      const [forCreator, forTarget] = await Promise.all([
        getConversationForViewer(userId, created.id),
        getConversationForViewer(input.userId, created.id),
      ]);
      emitToUser(userId, 'conversation:new', forCreator);
      emitToUser(input.userId, 'conversation:new', forTarget);

      return { conversation: forCreator, created: true };
    } catch (err) {
      // Handle concurrent creation race safely via unique directKey
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await prisma.conversation.findUnique({ where: { directKey }, select: { id: true } });
        if (raced) {
          return { conversation: await getConversationForViewer(userId, raced.id), created: false };
        }
      }
      throw err;
    }
  }

  // GROUP conversation
  const otherIds = [...new Set(input.memberIds)].filter((id) => id !== userId);
  if (otherIds.length === 0) {
    throw badRequest('Add at least one other member to create a group');
  }

  const foundUsers = await prisma.user.findMany({
    where: { id: { in: otherIds } },
    select: { id: true },
  });
  if (foundUsers.length !== otherIds.length) {
    throw badRequest('One or more selected users do not exist');
  }

  // Prevent block-evasion via group creation: users who blocked the creator cannot be added.
  const blockingCreator = await prisma.userBlock.findFirst({
    where: { blockerId: { in: otherIds }, blockedId: userId },
    select: { id: true },
  });
  if (blockingCreator) {
    throw forbidden('One or more selected users cannot be added to a group');
  }

  const created = await prisma.conversation.create({
    data: {
      type: 'GROUP',
      name: input.name,
      createdById: userId,
      members: {
        create: [
          { userId, role: 'OWNER' },
          ...otherIds.map((id) => ({ userId: id, role: 'MEMBER' as const })),
        ],
      },
    },
    select: { id: true },
  });

  await audit({
    action: 'conversation.group.created',
    actorId: userId,
    targetType: 'conversation',
    targetId: created.id,
    meta,
    metadata: { memberCount: otherIds.length + 1 },
  });

  const allMemberIds = [userId, ...otherIds];
  await Promise.all(allMemberIds.map((id) => joinUserToConversationRoom(id, created.id)));

  const forCreator = await getConversationForViewer(userId, created.id);
  emitToUser(userId, 'conversation:new', forCreator);

  await Promise.all(
    otherIds.map(async (memberId) => {
      const dto = await getConversationForViewer(memberId, created.id);
      emitToUser(memberId, 'conversation:new', dto);
      await createNotification({
        userId: memberId,
        type: 'ADDED_TO_GROUP',
        conversationId: created.id,
        data: { groupName: input.name, addedById: userId },
      });
    }),
  );

  return { conversation: forCreator, created: true };
}

export async function updateConversation(
  userId: string,
  conversationId: string,
  input: UpdateConversationInput,
  meta: ClientMeta,
): Promise<ConversationDto> {
  const membership = await requireActiveMembership(userId, conversationId);

  if (input.name !== undefined) {
    if (membership.conversation.type !== 'GROUP') {
      throw badRequest('Direct conversations cannot be renamed');
    }
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
      throw forbidden('Only group owners and admins can rename the group');
    }
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { name: input.name },
    });
    await audit({
      action: 'conversation.group.renamed',
      actorId: userId,
      targetType: 'conversation',
      targetId: conversationId,
      meta,
    });
  }

  if (input.mutedUntil !== undefined) {
    await prisma.conversationMember.update({
      where: { id: membership.id },
      data: { mutedUntil: input.mutedUntil ? new Date(input.mutedUntil) : null },
    });
  }

  const updated = await getConversationForViewer(userId, conversationId);
  if (input.name !== undefined) {
    emitToConversation(conversationId, 'conversation:updated', sharedConversationFields(updated));
  }
  return updated;
}

export async function updateConversationAvatar(
  userId: string,
  conversationId: string,
  avatarUrl: string,
  meta: ClientMeta,
): Promise<ConversationDto> {
  const membership = await requireActiveMembership(userId, conversationId);
  if (membership.conversation.type !== 'GROUP') {
    throw badRequest('Direct conversations do not have a group avatar');
  }
  if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
    throw forbidden('Only group owners and admins can change the group image');
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { avatarUrl },
  });

  await audit({
    action: 'conversation.group.avatar_updated',
    actorId: userId,
    targetType: 'conversation',
    targetId: conversationId,
    meta,
  });

  const updated = await getConversationForViewer(userId, conversationId);
  emitToConversation(conversationId, 'conversation:updated', sharedConversationFields(updated));
  return updated;
}

export async function addGroupMembers(
  userId: string,
  conversationId: string,
  userIds: string[],
  meta: ClientMeta,
): Promise<ConversationDto> {
  const membership = await requireActiveMembership(userId, conversationId);
  if (membership.conversation.type !== 'GROUP') {
    throw badRequest('Members can only be added to group conversations');
  }
  if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
    throw forbidden('Only group owners and admins can add members');
  }

  const uniqueIds = [...new Set(userIds)].filter((id) => id !== userId);
  if (uniqueIds.length === 0) {
    throw badRequest('Provide at least one other user to add');
  }

  const existingUsers = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: publicUserSelect,
  });
  if (existingUsers.length !== uniqueIds.length) {
    throw badRequest('One or more users do not exist');
  }

  const blockingActor = await prisma.userBlock.findFirst({
    where: { blockerId: { in: uniqueIds }, blockedId: userId },
    select: { id: true },
  });
  if (blockingActor) {
    throw forbidden('One or more selected users cannot be added to this group');
  }

  const addedIds: string[] = [];
  for (const targetId of uniqueIds) {
    const prev = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: targetId } },
    });
    if (prev && prev.leftAt === null) continue;
    if (prev) {
      // joinedAt is the boundary of what this member may read, and message createdAt is
      // stamped by PostgreSQL's clock, so stamp joinedAt with the same clock (now())
      // rather than the API server's, which may drift.
      await prisma.$executeRaw`
        UPDATE "ConversationMember"
        SET "leftAt" = NULL, "role" = 'MEMBER', "joinedAt" = now()
        WHERE "id" = ${prev.id}::uuid
      `;
    } else {
      await prisma.conversationMember.create({
        data: { conversationId, userId: targetId, role: 'MEMBER' },
      });
    }
    addedIds.push(targetId);
  }

  if (addedIds.length > 0) {
    await audit({
      action: 'conversation.members.added',
      actorId: userId,
      targetType: 'conversation',
      targetId: conversationId,
      meta,
      metadata: { addedIds },
    });
  }

  const updated = await getConversationForViewer(userId, conversationId);

  for (const addedId of addedIds) {
    await joinUserToConversationRoom(addedId, conversationId);
    const memberObj = updated.members.find((m) => m.user.id === addedId);
    if (memberObj) {
      emitToConversation(conversationId, 'member:added', { conversationId, member: memberObj });
    }
    const forNewMember = await getConversationForViewer(addedId, conversationId);
    emitToUser(addedId, 'conversation:new', forNewMember);
    await createNotification({
      userId: addedId,
      type: 'ADDED_TO_GROUP',
      conversationId,
      data: { groupName: membership.conversation.name ?? 'Group', addedById: userId },
    });
  }

  return updated;
}

export async function removeGroupMember(
  userId: string,
  conversationId: string,
  targetUserId: string,
  meta: ClientMeta,
): Promise<void> {
  const actor = await requireActiveMembership(userId, conversationId);
  if (actor.conversation.type !== 'GROUP') {
    throw badRequest('Members can only be removed from group conversations');
  }
  if (targetUserId === userId) {
    throw badRequest('Use the leave endpoint to leave a group');
  }
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
    throw forbidden('Only group owners and admins can remove members');
  }

  const target = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: targetUserId, leftAt: null },
  });
  if (!target) throw notFound('Member');

  // Strict RBAC matrix: ADMIN cannot remove ADMIN or OWNER; nobody can remove OWNER
  if (target.role === 'OWNER') {
    throw forbidden('The group owner cannot be removed');
  }
  if (actor.role === 'ADMIN' && target.role === 'ADMIN') {
    throw forbidden('Admins cannot remove other admins');
  }

  await prisma.conversationMember.update({
    where: { id: target.id },
    data: { leftAt: new Date() },
  });

  await removeUserFromConversationRoom(targetUserId, conversationId);
  emitToConversation(conversationId, 'member:removed', { conversationId, userId: targetUserId });
  emitToUser(targetUserId, 'conversation:removed', { conversationId });

  await createNotification({
    userId: targetUserId,
    type: 'REMOVED_FROM_GROUP',
    conversationId,
    data: { groupName: actor.conversation.name ?? 'Group', removedById: userId },
  });

  await audit({
    action: 'conversation.member.removed',
    actorId: userId,
    targetType: 'conversation',
    targetId: conversationId,
    meta,
    metadata: { removedUserId: targetUserId },
  });
}

export async function updateMemberRole(
  userId: string,
  conversationId: string,
  targetUserId: string,
  role: 'ADMIN' | 'MEMBER',
  meta: ClientMeta,
): Promise<MemberDto> {
  const actor = await requireActiveMembership(userId, conversationId);
  if (actor.conversation.type !== 'GROUP') {
    throw badRequest('Roles only exist in group conversations');
  }
  if (actor.role !== 'OWNER') {
    throw forbidden('Only the group owner can change member roles');
  }
  if (targetUserId === userId) {
    throw badRequest('Owner cannot demote themselves');
  }

  const target = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: targetUserId, leftAt: null },
    include: { user: { select: publicUserSelect } },
  });
  if (!target) throw notFound('Member');

  const updated = await prisma.conversationMember.update({
    where: { id: target.id },
    data: { role },
    include: { user: { select: publicUserSelect } },
  });

  emitToConversation(conversationId, 'member:role', { conversationId, userId: targetUserId, role });

  await createNotification({
    userId: targetUserId,
    type: 'ROLE_CHANGED',
    conversationId,
    data: { groupName: actor.conversation.name ?? 'Group', role },
  });

  await audit({
    action: 'conversation.member.role_changed',
    actorId: userId,
    targetType: 'conversation',
    targetId: conversationId,
    meta,
    metadata: { targetUserId, role },
  });

  const [publicUser] = await toPublicUsers(userId, [updated.user]);
  return {
    user: publicUser!,
    role: updated.role,
    joinedAt: updated.joinedAt.toISOString(),
  };
}

export async function leaveGroup(
  userId: string,
  conversationId: string,
  meta: ClientMeta,
): Promise<void> {
  const actor = await requireActiveMembership(userId, conversationId);
  if (actor.conversation.type !== 'GROUP') {
    throw badRequest('You cannot leave a direct conversation');
  }

  const promotedUserId = await prisma.$transaction(async (tx) => {
    await tx.conversationMember.update({
      where: { id: actor.id },
      data: { leftAt: new Date() },
    });

    if (actor.role !== 'OWNER') return null;

    // Transfer ownership to longest-standing ADMIN, else longest-standing MEMBER
    const remaining = await tx.conversationMember.findMany({
      where: { conversationId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });
    const successor = remaining.find((m) => m.role === 'ADMIN') ?? remaining[0];
    if (!successor) return null;

    await tx.conversationMember.update({
      where: { id: successor.id },
      data: { role: 'OWNER' },
    });
    return successor.userId;
  });

  await removeUserFromConversationRoom(userId, conversationId);
  emitToConversation(conversationId, 'member:removed', { conversationId, userId });
  emitToUser(userId, 'conversation:removed', { conversationId });

  if (promotedUserId) {
    emitToConversation(conversationId, 'member:role', {
      conversationId,
      userId: promotedUserId,
      role: 'OWNER',
    });
  }

  await audit({
    action: 'conversation.group.left',
    actorId: userId,
    targetType: 'conversation',
    targetId: conversationId,
    meta,
    metadata: { promotedUserId },
  });
}

export async function markConversationRead(
  userId: string,
  conversationId: string,
  messageId: string,
): Promise<{ updatedCount: number }> {
  const membership = await requireActiveMembership(userId, conversationId);

  const pivot = await prisma.message.findFirst({
    where: { id: messageId, conversationId, createdAt: { gte: membership.joinedAt } },
    select: { id: true, createdAt: true },
  });
  if (!pivot) throw notFound('Message');

  const now = new Date();

  const pendingReceipts = await prisma.messageReceipt.findMany({
    where: {
      userId,
      readAt: null,
      message: {
        conversationId,
        OR: [
          { createdAt: { lt: pivot.createdAt } },
          { createdAt: pivot.createdAt, id: { lte: pivot.id } },
        ],
      },
    },
    select: {
      id: true,
      messageId: true,
      deliveredAt: true,
      message: { select: { senderId: true } },
    },
  });

  if (pendingReceipts.length > 0) {
    const ids = pendingReceipts.map((r) => r.id);
    await prisma.$transaction([
      prisma.messageReceipt.updateMany({
        where: { id: { in: ids }, deliveredAt: null },
        data: { deliveredAt: now, readAt: now },
      }),
      prisma.messageReceipt.updateMany({
        where: { id: { in: ids }, deliveredAt: { not: null } },
        data: { readAt: now },
      }),
      prisma.conversationMember.update({
        where: { id: membership.id },
        data: { lastReadMessageId: pivot.id, lastReadAt: now },
      }),
    ]);

    // Group updated messageIds by senderId so each sender gets a clean receipt:update
    const bySender = new Map<string, string[]>();
    for (const r of pendingReceipts) {
      const list = bySender.get(r.message.senderId);
      if (list) list.push(r.messageId);
      else bySender.set(r.message.senderId, [r.messageId]);
    }

    const atIso = now.toISOString();
    for (const [senderId, messageIds] of bySender.entries()) {
      emitToUser(senderId, 'receipt:update', {
        conversationId,
        messageIds,
        userId,
        status: 'read',
        at: atIso,
      });
    }
  } else {
    await prisma.conversationMember.update({
      where: { id: membership.id },
      data: { lastReadMessageId: pivot.id, lastReadAt: now },
    });
  }

  // A message you have read no longer needs a "new message" notification. Clear the
  // ones for this conversation up to the read point, and tell all of this user's
  // tabs and devices so their notification badges update too.
  const cleared = await prisma.notification.updateMany({
    where: {
      userId,
      conversationId,
      type: 'NEW_MESSAGE',
      readAt: null,
      message: {
        OR: [
          { createdAt: { lt: pivot.createdAt } },
          { createdAt: pivot.createdAt, id: { lte: pivot.id } },
        ],
      },
    },
    data: { readAt: now },
  });
  if (cleared.count > 0) {
    emitToUser(userId, 'notification:cleared', { conversationId, count: cleared.count });
  }

  return { updatedCount: pendingReceipts.length };
}

export async function listConversationAttachments(
  userId: string,
  conversationId: string,
  opts: { limit: number; cursor?: string },
): Promise<{ attachments: AttachmentDto[]; nextCursor: string | null }> {
  const { joinedAt: since } = await requireActiveMembership(userId, conversationId);
  const parsed = opts.cursor ? decodeTimestampCursor(opts.cursor) : null;

  const rows = await prisma.attachment.findMany({
    where: {
      message: { conversationId, deletedAt: null, createdAt: { gte: since } },
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
  });

  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    attachments: page.map(toAttachmentDto),
    nextCursor: rows.length > opts.limit && last ? encodeTimestampCursor(last.createdAt, last.id) : null,
  };
}

/** Returns user IDs of everyone who shares at least one active conversation with `userId`. */
export async function getConversationPeerIds(userId: string): Promise<string[]> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId, leftAt: null },
    select: { conversationId: true },
  });
  if (memberships.length === 0) return [];
  const convIds = memberships.map((m) => m.conversationId);

  const peers = await prisma.conversationMember.findMany({
    where: {
      conversationId: { in: convIds },
      userId: { not: userId },
      leftAt: null,
    },
    select: { userId: true },
    distinct: ['userId'],
  });

  if (peers.length === 0) return [];
  const peerIds = peers.map((p) => p.userId);

  // Exclude anyone with a block in either direction so presence is never leaked.
  const blocks = await prisma.userBlock.findMany({
    where: {
      OR: [
        { blockerId: userId, blockedId: { in: peerIds } },
        { blockerId: { in: peerIds }, blockedId: userId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  const blocked = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
  return peerIds.filter((id) => !blocked.has(id));
}
