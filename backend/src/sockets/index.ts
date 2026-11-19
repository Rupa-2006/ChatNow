import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { redis } from '../config/redis.js';
import { audit } from '../services/audit.service.js';
import {
  getConversationPeerIds,
  markConversationRead,
  requireActiveMembership,
} from '../services/conversation.service.js';
import {
  addReaction,
  deleteMessage,
  editMessage,
  flushPendingDeliveries,
  markMessagesDelivered,
  removeReaction,
  sendMessage,
} from '../services/message.service.js';
import {
  getPresenceForUsers,
  isUserOnline,
  PRESENCE_HEARTBEAT_MS,
  refreshSocketPresence,
  registerSocketPresence,
  unregisterSocketPresence,
} from '../services/presence.service.js';
import { isSessionRevoked } from '../services/session.service.js';
import { AppError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/tokens.js';
import {
  socketAuthRefreshSchema,
  socketConversationReadSchema,
  socketDeleteMessageSchema,
  socketDeliveredSchema,
  socketEditMessageSchema,
  socketPresenceSubscribeSchema,
  socketReactMessageSchema,
  socketSendMessageSchema,
  socketTypingSchema,
} from '../validators/socket.validators.js';
import { conversationRoom, emitToUsers, registerSocketServer, runWithSocketServer, userRoom } from './hub.js';
import { checkSocketRateLimit } from './rateLimit.js';

export type SocketAuthData = {
  userId: string;
  sessionId: string;
  exp: number;
  connectedAt: number;
  abuseStrikes: number;
};

type AckFn<T = undefined> = (
  res: { ok: true; data?: T } | { ok: false; error: { code: string; message: string } },
) => void;

// Presence heartbeat interval; paired with the presence TTL in presence.service.ts.
const HEARTBEAT_INTERVAL_MS = PRESENCE_HEARTBEAT_MS;
const OFFLINE_GRACE_MS = 5_000;
const MAX_ABUSE_STRIKES = 5;

function toSocketError(err: unknown): { code: string; message: string } {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof ZodError) {
    return { code: 'VALIDATION_ERROR', message: err.issues[0]?.message ?? 'Invalid payload' };
  }
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

function safeAck<T>(ack: unknown, res: { ok: true; data?: T } | { ok: false; error: { code: string; message: string } }): void {
  if (typeof ack === 'function') {
    (ack as AckFn<T>)(res);
  }
}

export type SocketServerOptions = {
  /** Override offline grace period (shortened in tests). */
  offlineGraceMs?: number;
  /** Attach @socket.io/redis-adapter for cross-instance Pub/Sub broadcasting. */
  useRedisAdapter?: boolean;
  /** Register this server as the process-wide default hub (default: true). */
  registerGlobal?: boolean;
};

export type AttachedSocketServer = {
  io: Server;
  /** Closes Socket.IO and any dedicated Redis adapter pub/sub connections. */
  close: () => Promise<void>;
};

export async function attachSocketServer(
  httpServer: HttpServer,
  options: SocketServerOptions = {},
): Promise<AttachedSocketServer> {
  const offlineGraceMs = options.offlineGraceMs ?? OFFLINE_GRACE_MS;
  const useRedisAdapter = options.useRedisAdapter ?? env.redisAdapterEnabled;
  const registerGlobal = options.registerGlobal ?? true;

  const io = new Server(httpServer, {
    path: '/socket.io',
    // WebSocket-only avoids HTTP long-polling sticky-session requirements behind Nginx.
    transports: ['websocket'],
    maxHttpBufferSize: 100 * 1024, // 100 KB
    cors: {
      origin: env.corsOrigins,
      credentials: true,
    },
  });

  let pubClient: ReturnType<typeof redis.duplicate> | null = null;
  let subClient: ReturnType<typeof redis.duplicate> | null = null;

  if (useRedisAdapter) {
    pubClient = redis.duplicate();
    subClient = redis.duplicate();
    pubClient.on('error', (err) => {
      logger.error({ event: 'redis.adapter_pub_error', reason: err.message }, 'Socket.IO Redis pub error');
    });
    subClient.on('error', (err) => {
      logger.error({ event: 'redis.adapter_sub_error', reason: err.message }, 'Socket.IO Redis sub error');
    });
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient, { key: 'chatnow:socketio' }));
    logger.info({ event: 'socket.redis_adapter_ready' }, 'Socket.IO Redis adapter attached');
  }

  if (registerGlobal) {
    registerSocketServer(io);
  }

  // Handshake authentication middleware
  io.use(async (socket, next) => {
    const token =
      typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token.trim()
        : undefined;

    if (!token) {
      logger.warn({ event: 'socket.auth_failed', reason: 'missing_token' });
      return next(new Error('UNAUTHENTICATED'));
    }

    const claims = verifyAccessToken(token);
    if (!claims) {
      logger.warn({ event: 'socket.auth_failed', reason: 'invalid_token' });
      return next(new Error('UNAUTHENTICATED'));
    }

    if (await isSessionRevoked(claims.sid)) {
      logger.warn({ event: 'socket.auth_failed', userId: claims.sub, reason: 'session_revoked' });
      return next(new Error('UNAUTHENTICATED'));
    }

    const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true } });
    if (!user) {
      logger.warn({ event: 'socket.auth_failed', userId: claims.sub, reason: 'user_not_found' });
      return next(new Error('UNAUTHENTICATED'));
    }

    socket.data = {
      userId: claims.sub,
      sessionId: claims.sid,
      exp: claims.exp,
      connectedAt: Date.now(),
      abuseStrikes: 0,
    } satisfies SocketAuthData;

    return next();
  });

  const pendingOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Not async on purpose: every listener (including 'disconnect') must be attached
  // synchronously, before the first await. Socket.IO does not buffer events for
  // listeners attached later, so anything that arrived during setup used to be dropped,
  // and a disconnect during setup skipped cleanup and left the user "online" forever.
  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketAuthData;
    const { userId } = data;
    let closed = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    // Cancel any pending offline transition if the user reconnected within the grace period.
    const existingTimer = pendingOfflineTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      pendingOfflineTimers.delete(userId);
    }

    // Token expiry timer
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleExpiry = (expUnixSeconds: number) => {
      if (expiryTimer) clearTimeout(expiryTimer);
      const msRemaining = Math.max(1_000, expUnixSeconds * 1000 - Date.now());
      expiryTimer = setTimeout(() => {
        socket.emit('session:revoked', { reason: 'token_expired' });
        socket.disconnect(true);
      }, msRemaining);
      expiryTimer.unref();
    };
    scheduleExpiry(data.exp);

    /**
     * Room membership and presence registration. Event handlers wait for it, so a
     * message sent the instant the socket connects is still processed after the
     * socket is in its rooms; 'disconnect' waits for it, so it never runs before the
     * presence entry it has to remove exists.
     */
    const setup: Promise<void> = (async () => {
      // Step 4: Server-assigned rooms only (clients can never request room joins).
      await socket.join(userRoom(userId));
      const memberships = await prisma.conversationMember.findMany({
        where: { userId, leftAt: null },
        select: { conversationId: true },
      });
      await Promise.all(memberships.map((m) => socket.join(conversationRoom(m.conversationId))));

      // Step 5: Redis presence + heartbeat
      const { becameOnline } = await registerSocketPresence(userId, socket.id);
      if (closed) return; // disconnected meanwhile: the disconnect handler cleans up
      if (becameOnline) {
        const peerIds = await getConversationPeerIds(userId);
        emitToUsers(peerIds, 'presence:update', { userId, isOnline: true, lastSeenAt: null });
      }

      heartbeatTimer = setInterval(() => {
        void refreshSocketPresence(userId, socket.id);
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref();

      // Step 6: Flush offline-queued deliveries
      void flushPendingDeliveries(userId).catch((err) => {
        logger.warn({ event: 'socket.flush_deliveries_failed', userId, err });
      });

      logger.info({
        event: 'socket.connected',
        userId,
        socketId: socket.id,
        rooms: memberships.length,
      });
    })();

    // Never leave a rejection unhandled; a failed setup gets the socket closed.
    const ready: Promise<boolean> = setup.then(
      () => !closed,
      (err) => {
        logger.error({ event: 'socket.setup_failed', userId, err }, 'Socket connection setup failed');
        socket.disconnect(true);
        return false;
      },
    );

    // Each handler below starts by awaiting `ready`; this wraps that around all of them.
    const originalOn = socket.on.bind(socket);
    const on = (event: string, handler: (...args: unknown[]) => Promise<void>) =>
      originalOn(event, async (...args: unknown[]) => {
        if (!(await ready)) {
          const ack = args[args.length - 1];
          safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Connection is closing' } });
          return;
        }
        await handler(...args);
      });

    const enforceRateLimit = async (
      kind: 'message' | 'typing' | 'other',
      eventName: string,
      ack?: unknown,
    ): Promise<boolean> => {
      const { allowed } = await checkSocketRateLimit(userId, kind);
      if (allowed) return true;

      data.abuseStrikes += 1;
      logger.warn({ event: 'socket.rate_limited', userId, socketEvent: eventName, strikes: data.abuseStrikes });
      safeAck(ack, { ok: false, error: { code: 'RATE_LIMITED', message: 'Slow down; rate limit exceeded' } });

      if (data.abuseStrikes >= MAX_ABUSE_STRIKES) {
        await audit({
          action: 'socket.disconnected_abuse',
          actorId: userId,
          meta: { ip: socket.handshake.address ?? null, userAgent: socket.handshake.headers['user-agent'] ?? null },
          metadata: { eventName, strikes: data.abuseStrikes },
        });
        socket.disconnect(true);
      }
      return false;
    };

    const meta = {
      ip: socket.handshake.address ?? null,
      userAgent: typeof socket.handshake.headers['user-agent'] === 'string'
        ? socket.handshake.headers['user-agent'].slice(0, 512)
        : null,
    };

    // --- Event handlers ----------------------------------------------------

    on('message:send', async (payload: unknown, ack?: unknown) => {
      await runWithSocketServer(io, async () => {
        if (!(await enforceRateLimit('message', 'message:send', ack))) return;
        try {
          const input = socketSendMessageSchema.parse(payload);
          const { message } = await sendMessage(userId, input.conversationId, {
            content: input.content,
            clientId: input.clientId,
            replyToId: input.replyToId,
            attachmentIds: input.attachmentIds,
          });
          safeAck(ack, { ok: true, data: message });
        } catch (err) {
          if (err instanceof AppError && (err.code === 'FORBIDDEN' || err.code === 'NOT_FOUND')) {
            logger.warn({ event: 'socket.forbidden', userId, socketEvent: 'message:send', code: err.code });
          }
          safeAck(ack, { ok: false, error: toSocketError(err) });
        }
      });
    });

    on('message:edit', async (payload: unknown, ack?: unknown) => {
      await runWithSocketServer(io, async () => {
        if (!(await enforceRateLimit('other', 'message:edit', ack))) return;
        try {
          const input = socketEditMessageSchema.parse(payload);
          const message = await editMessage(userId, input.messageId, input.content);
          safeAck(ack, { ok: true, data: message });
        } catch (err) {
          safeAck(ack, { ok: false, error: toSocketError(err) });
        }
      });
    });

    on('message:delete', async (payload: unknown, ack?: unknown) => {
      await runWithSocketServer(io, async () => {
        if (!(await enforceRateLimit('other', 'message:delete', ack))) return;
        try {
          const input = socketDeleteMessageSchema.parse(payload);
          await deleteMessage(userId, input.messageId, meta);
          safeAck(ack, { ok: true });
        } catch (err) {
          safeAck(ack, { ok: false, error: toSocketError(err) });
        }
      });
    });

    on('message:react', async (payload: unknown, ack?: unknown) => {
      await runWithSocketServer(io, async () => {
        if (!(await enforceRateLimit('other', 'message:react', ack))) return;
        try {
          const input = socketReactMessageSchema.parse(payload);
          const message = input.remove
            ? await removeReaction(userId, input.messageId, input.emoji)
            : await addReaction(userId, input.messageId, input.emoji);
          safeAck(ack, { ok: true, data: message });
        } catch (err) {
          safeAck(ack, { ok: false, error: toSocketError(err) });
        }
      });
    });

    on('message:delivered', async (payload: unknown, ack?: unknown) => {
      await runWithSocketServer(io, async () => {
        if (!(await enforceRateLimit('other', 'message:delivered', ack))) return;
        try {
          const input = socketDeliveredSchema.parse(payload);
          await markMessagesDelivered(userId, input.messageIds);
          safeAck(ack, { ok: true });
        } catch (err) {
          safeAck(ack, { ok: false, error: toSocketError(err) });
        }
      });
    });

    on('conversation:read', async (payload: unknown, ack?: unknown) => {
      await runWithSocketServer(io, async () => {
        if (!(await enforceRateLimit('other', 'conversation:read', ack))) return;
        try {
          const input = socketConversationReadSchema.parse(payload);
          const { updatedCount } = await markConversationRead(userId, input.conversationId, input.messageId);
          if (updatedCount > 0) {
            logger.info({
              event: 'message.read',
              userId,
              conversationId: input.conversationId,
              count: updatedCount,
            });
          }
          safeAck(ack, { ok: true });
        } catch (err) {
          safeAck(ack, { ok: false, error: toSocketError(err) });
        }
      });
    });

    on('typing:start', async (payload: unknown) => {
      if (!(await enforceRateLimit('typing', 'typing:start'))) return;
      try {
        const { conversationId } = socketTypingSchema.parse(payload);
        await requireActiveMembership(userId, conversationId);
        socket.to(conversationRoom(conversationId)).emit('typing:update', {
          conversationId,
          userId,
          isTyping: true,
        });
      } catch {
        // Silently drop unauthorized or malformed typing events
      }
    });

    on('typing:stop', async (payload: unknown) => {
      if (!(await enforceRateLimit('typing', 'typing:stop'))) return;
      try {
        const { conversationId } = socketTypingSchema.parse(payload);
        await requireActiveMembership(userId, conversationId);
        socket.to(conversationRoom(conversationId)).emit('typing:update', {
          conversationId,
          userId,
          isTyping: false,
        });
      } catch {
        // Silently drop
      }
    });

    on('presence:subscribe', async (payload: unknown, ack?: unknown) => {
      if (!(await enforceRateLimit('other', 'presence:subscribe', ack))) return;
      try {
        const { userIds } = socketPresenceSubscribeSchema.parse(payload);
        const presence = await getPresenceForUsers(userId, userIds);
        safeAck(ack, { ok: true, data: presence });
      } catch (err) {
        safeAck(ack, { ok: false, error: toSocketError(err) });
      }
    });

    on('auth:refresh', async (payload: unknown, ack?: unknown) => {
      if (!(await enforceRateLimit('other', 'auth:refresh', ack))) return;
      try {
        const { token } = socketAuthRefreshSchema.parse(payload);
        const claims = verifyAccessToken(token);
        if (!claims || claims.sub !== userId) {
          safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid refresh token' } });
          socket.disconnect(true);
          return;
        }
        if (await isSessionRevoked(claims.sid)) {
          safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Session revoked' } });
          socket.disconnect(true);
          return;
        }
        data.sessionId = claims.sid;
        data.exp = claims.exp;
        scheduleExpiry(claims.exp);
        safeAck(ack, { ok: true });
      } catch (err) {
        safeAck(ack, { ok: false, error: toSocketError(err) });
      }
    });

    // --- Disconnect & grace-period presence --------------------------------
    socket.on('disconnect', async (reason) => {
      closed = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      // Wait until setup has finished registering presence, so it can be removed.
      await setup.catch(() => {});
      if (heartbeatTimer) clearInterval(heartbeatTimer);

      const durationMs = Date.now() - data.connectedAt;
      logger.info({ event: 'socket.disconnected', userId, socketId: socket.id, reason, durationMs });

      let remaining: number;
      try {
        ({ remaining } = await unregisterSocketPresence(userId, socket.id));
      } catch (err) {
        // Typically Redis already closing during shutdown. The presence key has a TTL,
        // so a missed removal expires on its own; never leave the rejection unhandled.
        logger.warn({ event: 'presence.unregister_failed', userId, reason: (err as Error).message });
        return;
      }
      if (remaining > 0) return;

      // 5s grace period prevents page reloads from flickering offline
      const timer = setTimeout(async () => {
        pendingOfflineTimers.delete(userId);
        try {
          if (await isUserOnline(userId)) return;
          const now = new Date();
          await prisma.user.update({
            where: { id: userId },
            data: { lastSeenAt: now },
          });
          const peerIds = await getConversationPeerIds(userId);
          emitToUsers(peerIds, 'presence:update', {
            userId,
            isOnline: false,
            lastSeenAt: now.toISOString(),
          });
        } catch (err) {
          logger.warn({ event: 'presence.offline_update_failed', userId, err });
        }
      }, offlineGraceMs);
      timer.unref();
      pendingOfflineTimers.set(userId, timer);
    });
  });

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.allSettled([pubClient?.quit(), subClient?.quit()]);
  };

  return { io, close };
}
