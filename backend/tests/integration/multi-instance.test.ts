import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachSocketServer, type AttachedSocketServer } from '../../src/sockets/index.js';
import { app, closeConnections, registerUser, resetState } from './helpers.js';

/**
 * Multi-instance distributed test (Phase 5 verification gate).
 *
 * Boots TWO completely separate Socket.IO servers (`api-1` and `api-2`) sharing Redis
 * through `@socket.io/redis-adapter`. Alice connects directly to `api-1` and Bob connects
 * directly to `api-2`. Because each handler runs inside `runWithSocketServer(io, ...)`,
 * emits from `api-1` ONLY hit `io1` and can ONLY reach Bob on `api-2` via Redis Pub/Sub.
 */

type TestInstance = {
  httpServer: HttpServer;
  socketServer: AttachedSocketServer;
  url: string;
};

async function startInstance(useRedisAdapter: boolean): Promise<TestInstance> {
  const httpServer = createServer(app);
  const socketServer = await attachSocketServer(httpServer, {
    offlineGraceMs: 150,
    useRedisAdapter,
    registerGlobal: false,
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const addr = httpServer.address() as AddressInfo;
  return { httpServer, socketServer, url: `http://127.0.0.1:${addr.port}` };
}

async function stopInstance(inst: TestInstance): Promise<void> {
  await inst.socketServer.close();
  await new Promise<void>((resolve) => inst.httpServer.close(() => resolve()));
}

function connectTo(url: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioClient(url, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
    });
    client.once('connect', () => resolve(client));
    client.once('connect_error', (err) => {
      client.close();
      reject(err);
    });
  });
}

function waitForEvent<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Multi-instance Redis Pub/Sub broadcasting (api-1 <-> api-2)', () => {
  let api1: TestInstance;
  let api2: TestInstance;

  beforeAll(async () => {
    api1 = await startInstance(true);
    api2 = await startInstance(true);
  });

  afterAll(async () => {
    await Promise.all([stopInstance(api1), stopInstance(api2)]);
    await closeConnections();
  });

  beforeEach(async () => {
    await resetState();
  });

  it('delivers messages, typing indicators, and read receipts across api-1 and api-2 via Redis Pub/Sub', async () => {
    const alice = await registerUser('alice');
    const bob = await registerUser('bob');

    const convRes = await request(app)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ type: 'DIRECT', userId: bob.id });
    expect(convRes.status).toBe(201);
    const convId = convRes.body.data.id as string;

    // Alice connects strictly to api-1; Bob connects strictly to api-2
    const aliceOnApi1 = await connectTo(api1.url, alice.accessToken);
    const bobOnApi2 = await connectTo(api2.url, bob.accessToken);

    try {
      // 1. Typing indicator crosses api-1 -> Redis -> api-2
      const typingOnApi2 = waitForEvent<{ conversationId: string; userId: string; isTyping: boolean }>(
        bobOnApi2,
        'typing:update',
      );
      aliceOnApi1.emit('typing:start', { conversationId: convId });
      expect(await typingOnApi2).toEqual({
        conversationId: convId,
        userId: alice.id,
        isTyping: true,
      });

      // 2. Message sent on api-1 arrives instantly on api-2
      const msgOnApi2 = waitForEvent<{ id: string; content: string }>(bobOnApi2, 'message:new');
      const ack = await new Promise<{ ok: boolean; data?: { id: string } }>((resolve) => {
        aliceOnApi1.emit(
          'message:send',
          { conversationId: convId, content: 'Cross-server hello via Redis!', clientId: randomUUID() },
          resolve,
        );
      });
      expect(ack.ok).toBe(true);

      const delivered = await msgOnApi2;
      expect(delivered.content).toBe('Cross-server hello via Redis!');

      // 3. Read receipt sent by Bob on api-2 reaches Alice on api-1 via Redis
      const readOnApi1 = waitForEvent<{ status: string; messageIds: string[] }>(aliceOnApi1, 'receipt:update');
      bobOnApi2.emit('conversation:read', { conversationId: convId, messageId: delivered.id });
      const receipt = await readOnApi1;
      expect(receipt.status).toBe('read');
      expect(receipt.messageIds).toContain(delivered.id);
    } finally {
      aliceOnApi1.close();
      bobOnApi2.close();
    }
  });

  it('proves Redis adapter is required: two isolated servers WITHOUT Redis adapter do not relay events', async () => {
    const isolated1 = await startInstance(false);
    const isolated2 = await startInstance(false);

    const alice = await registerUser('alice_iso');
    const bob = await registerUser('bob_iso');
    const convRes = await request(app)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ type: 'DIRECT', userId: bob.id });
    const convId = convRes.body.data.id as string;

    const aliceSock = await connectTo(isolated1.url, alice.accessToken);
    const bobSock = await connectTo(isolated2.url, bob.accessToken);

    try {
      const bobWait = waitForEvent(bobSock, 'message:new', 600);
      await new Promise((resolve) => {
        aliceSock.emit(
          'message:send',
          { conversationId: convId, content: 'Should not cross without Redis', clientId: randomUUID() },
          resolve,
        );
      });
      await expect(bobWait).rejects.toThrow(/Timed out/);
    } finally {
      aliceSock.close();
      bobSock.close();
      await Promise.all([stopInstance(isolated1), stopInstance(isolated2)]);
    }
  });
});
