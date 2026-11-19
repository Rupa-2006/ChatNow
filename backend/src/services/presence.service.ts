import { prisma } from '../config/prisma.js';
import { redis } from '../config/redis.js';

/**
 * Presence lives in Redis so every API instance sees the same answer:
 * `presence:sockets:{userId}` is the set of that user's live socket ids with a TTL
 * refreshed by heartbeats, so sockets from a crashed instance age out automatically.
 */
export const presenceKey = (userId: string) => `presence:sockets:${userId}`;

/**
 * How long a user's presence set survives without a heartbeat. Two and a half
 * heartbeat intervals, so one late or lost heartbeat never flips anyone offline, while
 * sockets of a crashed instance still age out within a few minutes.
 */
export const PRESENCE_HEARTBEAT_MS = 60_000;
const PRESENCE_TTL_SECONDS = 150;

export async function registerSocketPresence(userId: string, socketId: string): Promise<{ becameOnline: boolean }> {
  const key = presenceKey(userId);
  const prevCount = await redis.scard(key);
  await redis.multi().sadd(key, socketId).expire(key, PRESENCE_TTL_SECONDS).exec();
  return { becameOnline: prevCount === 0 };
}

/**
 * Heartbeat. Normally a single EXPIRE (one Redis command), because hosted Redis free
 * tiers meter every command: the previous MULTI/SADD/EXPIRE/EXEC every 30 s cost about
 * 350K commands a month for one tab left open, most of Upstash's 500K free allowance.
 * Only if the key has vanished (e.g. Redis restarted) is the socket re-added.
 */
export async function refreshSocketPresence(userId: string, socketId: string): Promise<void> {
  const key = presenceKey(userId);
  const stillThere = await redis.expire(key, PRESENCE_TTL_SECONDS);
  if (stillThere === 0) {
    await redis.multi().sadd(key, socketId).expire(key, PRESENCE_TTL_SECONDS).exec();
  }
}

export async function unregisterSocketPresence(userId: string, socketId: string): Promise<{ remaining: number }> {
  const key = presenceKey(userId);
  await redis.srem(key, socketId);
  const remaining = await redis.scard(key);
  if (remaining > 0) {
    await redis.expire(key, PRESENCE_TTL_SECONDS);
  }
  return { remaining };
}

export async function isUserOnline(userId: string): Promise<boolean> {
  const count = await redis.scard(presenceKey(userId));
  return count > 0;
}

export async function getOnlineUserIds(userIds: string[]): Promise<Set<string>> {
  const online = new Set<string>();
  if (userIds.length === 0) return online;

  const pipeline = redis.pipeline();
  for (const id of userIds) pipeline.scard(presenceKey(id));
  const results = await pipeline.exec();

  results?.forEach(([err, count], i) => {
    const id = userIds[i];
    if (!err && id && Number(count) > 0) online.add(id);
  });
  return online;
}

/**
 * Returns presence for a list of userIds as seen by `viewerId`.
 * Withholds online status and lastSeenAt when a block exists in either direction.
 */
export async function getPresenceForUsers(
  viewerId: string,
  userIds: string[],
): Promise<Record<string, { isOnline: boolean; lastSeenAt: string | null }>> {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return {};

  const [users, blocks] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, lastSeenAt: true },
    }),
    prisma.userBlock.findMany({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: { in: uniqueIds } },
          { blockerId: { in: uniqueIds }, blockedId: viewerId },
        ],
      },
      select: { blockerId: true, blockedId: true },
    }),
  ]);

  const hidden = new Set(blocks.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId)));
  const visibleIds = users.map((u) => u.id).filter((id) => !hidden.has(id));
  const online = await getOnlineUserIds(visibleIds);

  const result: Record<string, { isOnline: boolean; lastSeenAt: string | null }> = {};
  for (const u of users) {
    if (hidden.has(u.id)) {
      result[u.id] = { isOnline: false, lastSeenAt: null };
    } else {
      result[u.id] = {
        isOnline: online.has(u.id),
        lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      };
    }
  }
  return result;
}
