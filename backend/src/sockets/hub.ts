import { AsyncLocalStorage } from 'node:async_hooks';
import type { Server } from 'socket.io';

/**
 * Reference to the live Socket.IO server.
 * In production each container runs one Node process with one Server (`ioRef`).
 * `socketServerContext` (AsyncLocalStorage) also allows multi-instance integration tests
 * to run two isolated Socket.IO servers inside one test process so emits from api-1
 * strictly hit io1 and can only reach io2 through Redis Pub/Sub.
 */
let ioRef: Server | null = null;
const socketServerContext = new AsyncLocalStorage<Server>();

export const userRoom = (userId: string) => `user:${userId}`;
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;

export function registerSocketServer(io: Server | null): void {
  ioRef = io;
}

export function getSocketServer(): Server | null {
  return socketServerContext.getStore() ?? ioRef;
}

export function runWithSocketServer<T>(io: Server, fn: () => T): T {
  return socketServerContext.run(io, fn);
}

export function emitToConversation(conversationId: string, event: string, payload: unknown): void {
  getSocketServer()?.to(conversationRoom(conversationId)).emit(event, payload);
}

/**
 * Broadcasts to a conversation room while skipping the given users' sockets (on every
 * instance, via the Redis adapter). Used to send those users a redacted payload instead.
 */
export function emitToConversationExcept(
  conversationId: string,
  excludedUserIds: string[],
  event: string,
  payload: unknown,
): void {
  const io = getSocketServer();
  if (!io) return;
  io.to(conversationRoom(conversationId))
    .except(excludedUserIds.map(userRoom))
    .emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  getSocketServer()?.to(userRoom(userId)).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown): void {
  const io = getSocketServer();
  if (!io || userIds.length === 0) return;
  let target = io.to(userRoom(userIds[0]!));
  for (let i = 1; i < userIds.length; i += 1) {
    target = target.to(userRoom(userIds[i]!));
  }
  target.emit(event, payload);
}

/** Joins all live sockets of `userId` (across all API instances via Redis adapter) into a conversation room. */
export async function joinUserToConversationRoom(userId: string, conversationId: string): Promise<void> {
  const io = getSocketServer();
  if (!io) return;
  await io.in(userRoom(userId)).socketsJoin(conversationRoom(conversationId));
}

/** Removes all live sockets of `userId` from a conversation room. */
export async function removeUserFromConversationRoom(userId: string, conversationId: string): Promise<void> {
  const io = getSocketServer();
  if (!io) return;
  await io.in(userRoom(userId)).socketsLeave(conversationRoom(conversationId));
}

/** Emits `session:revoked` and disconnects all sockets belonging to `userId` (across instances via Redis adapter). */
export async function disconnectUserSockets(
  userId: string,
  reason: string,
  onlySessionId?: string,
  exceptSessionId?: string,
): Promise<void> {
  const io = getSocketServer();
  if (!io) return;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  for (const sock of sockets) {
    const sid = (sock.data as { sessionId?: string }).sessionId;
    if (onlySessionId && sid !== onlySessionId) continue;
    if (exceptSessionId && sid === exceptSessionId) continue;
    sock.emit('session:revoked', { reason });
    sock.disconnect(true);
  }
}
