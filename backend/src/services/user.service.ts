import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import type { UpdateProfileInput } from '../validators/user.validators.js';
import { audit, type ClientMeta } from './audit.service.js';
import { deleteCachedKeys, getCachedJson, setCachedJson, userProfileCacheKey } from './cache.service.js';
import { getOnlineUserIds } from './presence.service.js';

/**
 * The only user columns that ever leave the server for *other* users. Selecting
 * explicitly (rather than excluding fields) means a column added later — like
 * passwordHash was — can never leak by default.
 */
export const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  lastSeenAt: true,
} satisfies Prisma.UserSelect;

export const meSelect = {
  ...publicUserSelect,
  email: true,
  notificationPrefs: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type PublicUserRow = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;
type MeRow = Prisma.UserGetPayload<{ select: typeof meSelect }>;

export type NotificationPrefs = { browser: boolean; sound: boolean; messagePreview: boolean };

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
};

export type Me = PublicUser & {
  email: string;
  createdAt: string;
  notificationPrefs: NotificationPrefs;
};

const DEFAULT_PREFS: NotificationPrefs = { browser: true, sound: true, messagePreview: true };

function readPrefs(value: Prisma.JsonValue): NotificationPrefs {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const pick = (k: keyof NotificationPrefs) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : DEFAULT_PREFS[k]);
  return { browser: pick('browser'), sound: pick('sound'), messagePreview: pick('messagePreview') };
}

export function toMe(row: MeRow): Me {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    // The caller is by definition active right now.
    isOnline: true,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    notificationPrefs: readPrefs(row.notificationPrefs),
  };
}

/**
 * Turns database rows into PublicUser objects as seen by `viewerId`. Presence (online
 * flag and last-seen time) is withheld when a block exists in either direction.
 */
export async function toPublicUsers(viewerId: string, rows: PublicUserRow[]): Promise<PublicUser[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const blocks = await prisma.userBlock.findMany({
    where: {
      OR: [
        { blockerId: viewerId, blockedId: { in: ids } },
        { blockerId: { in: ids }, blockedId: viewerId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  const hidden = new Set(blocks.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId)));
  const online = await getOnlineUserIds(ids.filter((id) => !hidden.has(id)));

  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    bio: r.bio,
    isOnline: online.has(r.id),
    lastSeenAt: hidden.has(r.id) ? null : (r.lastSeenAt?.toISOString() ?? null),
  }));
}

/** Users who have blocked the viewer are left out of directory and search results. */
const notBlockingViewer = (viewerId: string): Prisma.UserWhereInput => ({
  blocksMade: { none: { blockedId: viewerId } },
});

const encodeCursor = (username: string) => Buffer.from(username, 'utf8').toString('base64url');
const decodeCursor = (cursor: string) => Buffer.from(cursor, 'base64url').toString('utf8');

export async function listUsers(
  viewerId: string,
  { limit, cursor }: { limit: number; cursor?: string },
): Promise<{ users: PublicUser[]; nextCursor: string | null }> {
  // Keyset pagination on the unique username: "everything after the last one I saw".
  const rows = await prisma.user.findMany({
    where: {
      id: { not: viewerId },
      ...notBlockingViewer(viewerId),
      ...(cursor ? { username: { gt: decodeCursor(cursor) } } : {}),
    },
    orderBy: { username: 'asc' },
    take: limit + 1,
    select: publicUserSelect,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    users: await toPublicUsers(viewerId, page),
    nextCursor: rows.length > limit && last ? encodeCursor(last.username) : null,
  };
}

/** Escapes the characters that have special meaning inside a LIKE / ILIKE pattern. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function searchUsers(viewerId: string, q: string, limit: number): Promise<PublicUser[]> {
  const contains = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;

  // Raw SQL so the query matches the trigram indexes exactly ("username"::text and
  // "displayName"). Values are bound parameters — Prisma.sql never concatenates them
  // into the statement, so this is not an injection risk.
  const rows = await prisma.$queryRaw<PublicUserRow[]>(Prisma.sql`
    SELECT u."id", u."username"::text AS "username", u."displayName", u."avatarUrl", u."bio", u."lastSeenAt"
    FROM "User" u
    WHERE u."id" <> ${viewerId}::uuid
      AND (u."username"::text ILIKE ${contains} OR u."displayName" ILIKE ${contains})
      AND NOT EXISTS (
        SELECT 1 FROM "UserBlock" b
        WHERE b."blockerId" = u."id" AND b."blockedId" = ${viewerId}::uuid
      )
    ORDER BY (u."username"::text ILIKE ${prefix}) DESC, u."username" ASC
    LIMIT ${limit}
  `);
  return toPublicUsers(viewerId, rows);
}

export async function getUser(viewerId: string, userId: string): Promise<PublicUser> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!row) throw notFound('User');
  const [user] = await toPublicUsers(viewerId, [row]);
  if (!user) throw notFound('User');
  return user;
}

export async function getMe(userId: string): Promise<Me> {
  const cached = await getCachedJson<Me>(userProfileCacheKey(userId));
  if (cached) return cached;

  const row = await prisma.user.findUnique({ where: { id: userId }, select: meSelect });
  if (!row) throw notFound('User');
  const dto = toMe(row);
  await setCachedJson(userProfileCacheKey(userId), dto, 60);
  return dto;
}

export async function updateProfile(userId: string, input: UpdateProfileInput, meta: ClientMeta): Promise<Me> {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, notificationPrefs: true },
  });
  if (!current) throw notFound('User');

  const data: Prisma.UserUpdateInput = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.bio !== undefined) data.bio = input.bio === '' ? null : input.bio;
  if (input.username !== undefined && input.username !== current.username) data.username = input.username;
  if (input.notificationPrefs !== undefined) {
    const merged = { ...readPrefs(current.notificationPrefs) };
    for (const k of ['browser', 'sound', 'messagePreview'] as const) {
      const v = input.notificationPrefs[k];
      if (v !== undefined) merged[k] = v;
    }
    data.notificationPrefs = merged;
  }

  try {
    const row = await prisma.user.update({ where: { id: userId }, data, select: meSelect });
    await deleteCachedKeys(userProfileCacheKey(userId));
    await audit({
      action: 'user.profile.updated',
      actorId: userId,
      targetType: 'user',
      targetId: userId,
      meta,
      metadata: { fields: Object.keys(data) },
    });
    return toMe(row);
  } catch (err) {
    // The unique index is the real guard: two people claiming the same username at
    // the same moment cannot both win, whatever a pre-check would have said.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('That username is already taken', [{ path: 'username', message: 'Already taken' }]);
    }
    throw err;
  }
}

export async function listBlockedUsers(userId: string): Promise<PublicUser[]> {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    orderBy: { createdAt: 'desc' },
    select: { blocked: { select: publicUserSelect } },
  });
  return toPublicUsers(
    userId,
    rows.map((r) => r.blocked),
  );
}

export async function blockUser(userId: string, targetId: string, meta: ClientMeta): Promise<void> {
  if (userId === targetId) throw badRequest('You cannot block yourself');
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) throw notFound('User');

  // upsert makes blocking idempotent: blocking twice is not an error.
  await prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
    create: { blockerId: userId, blockedId: targetId },
    update: {},
  });
  await audit({ action: 'user.block', actorId: userId, targetType: 'user', targetId, meta });
}

export async function unblockUser(userId: string, targetId: string, meta: ClientMeta): Promise<void> {
  const { count } = await prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
  if (count > 0) await audit({ action: 'user.unblock', actorId: userId, targetType: 'user', targetId, meta });
}

/** True if either user has blocked the other. Used by messaging in Phase 4. */
export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}
