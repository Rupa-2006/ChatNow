import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachSocketServer, type AttachedSocketServer } from '../../src/sockets/index.js';
import { app, closeConnections, registerUser, resetState } from './helpers.js';

let httpServer: HttpServer;
let attached: AttachedSocketServer;
let baseUrl: string;

function connectSocket(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioClient(baseUrl, {
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

describe('Phase 4 messaging, group RBAC, attachments, and Socket.IO integration', () => {
  beforeAll(async () => {
    httpServer = createServer(app);
    attached = await attachSocketServer(httpServer, { offlineGraceMs: 150, useRedisAdapter: false });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const addr = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await attached.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await closeConnections();
  });

  beforeEach(async () => {
    await resetState();
  });

  it('rejects unauthenticated Socket.IO handshakes', async () => {
    await expect(connectSocket('not-a-valid-jwt')).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('does not leave a user online forever when they disconnect during connection setup', async () => {
    const alice = await registerUser('alice');
    const { presenceKey } = await import('../../src/services/presence.service.js');
    const { redis } = await import('./helpers.js');

    // Disconnect the instant the handshake completes, while the server is still
    // joining rooms and registering presence (what a fast page refresh or React
    // StrictMode's double mount does).
    for (let i = 0; i < 5; i++) {
      const socket = await connectSocket(alice.accessToken);
      socket.disconnect();
    }

    // Longer than the 150 ms offline grace period used by this test server.
    await new Promise((r) => setTimeout(r, 600));
    expect(await redis.scard(presenceKey(alice.id))).toBe(0);
  });

  it('clears "new message" notifications when the conversation is read', async () => {
    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const conv = await request(app).post('/api/conversations').set(bob.auth).send({ type: 'DIRECT', userId: alice.id });
    const convId = conv.body.data.id as string;

    const sent = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set(bob.auth)
      .send({ content: 'ping', clientId: randomUUID() });
    expect(sent.status).toBe(201);

    const unread = async () => (await request(app).get('/api/notifications').set(alice.auth)).body.meta.unreadCount;
    expect(await unread()).toBe(1);

    const read = await request(app)
      .post(`/api/conversations/${convId}/read`)
      .set(alice.auth)
      .send({ messageId: sent.body.data.id });
    expect(read.status).toBe(204);
    expect(await unread()).toBe(0);

    // Bob's own notifications are untouched by Alice reading.
    expect((await request(app).get('/api/notifications').set(bob.auth)).body.meta.unreadCount).toBe(0);
  });

  it('processes an event sent the instant the socket connects', async () => {
    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const conv = await request(app).post('/api/conversations').set(alice.auth).send({ type: 'DIRECT', userId: bob.id });

    const socket = await connectSocket(alice.accessToken);
    try {
      // Emitted synchronously after 'connect', before server-side setup has finished.
      const ack = await socket
        .timeout(4000)
        .emitWithAck('message:send', { conversationId: conv.body.data.id, content: 'first!', clientId: randomUUID() });
      expect(ack).toMatchObject({ ok: true, data: { content: 'first!' } });
    } finally {
      socket.disconnect();
    }
  });

  it('delivers direct messages in real time, advances ticks sent -> delivered -> read, and blocks non-members', async () => {
    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const carol = await registerUser('carol');

    // Create 1:1 conversation (second call is idempotent -> 200)
    const createRes = await request(app)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ type: 'DIRECT', userId: bob.id });
    expect(createRes.status).toBe(201);
    const convId = createRes.body.data.id as string;

    const repeatRes = await request(app)
      .post('/api/conversations')
      .set(bob.auth)
      .send({ type: 'DIRECT', userId: alice.id });
    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.data.id).toBe(convId);

    // Carol (non-member) receives 404 (not 403) to prevent ID enumeration
    const carolRead = await request(app).get(`/api/conversations/${convId}/messages`).set(carol.auth);
    expect(carolRead.status).toBe(404);

    // Connect Alice & Bob sockets
    const aliceSocket = await connectSocket(alice.accessToken);
    const bobSocket = await connectSocket(bob.accessToken);
    const carolSocket = await connectSocket(carol.accessToken);

    try {
      // Carol cannot send to Alice-Bob room over WebSocket either
      const carolAck = await new Promise<{ ok: boolean; error?: { code: string } }>((resolve) => {
        carolSocket.emit(
          'message:send',
          { conversationId: convId, content: 'intrusion', clientId: randomUUID() },
          resolve,
        );
      });
      expect(carolAck.ok).toBe(false);
      expect(carolAck.error?.code).toBe('NOT_FOUND');

      // Typing indicator relays to Bob
      const typingPromise = waitForEvent<{ conversationId: string; userId: string; isTyping: boolean }>(
        bobSocket,
        'typing:update',
      );
      aliceSocket.emit('typing:start', { conversationId: convId });
      const typingEvt = await typingPromise;
      expect(typingEvt).toEqual({ conversationId: convId, userId: alice.id, isTyping: true });

      // Alice sends message; Bob receives message:new instantly
      const bobReceivePromise = waitForEvent<{ id: string; content: string }>(bobSocket, 'message:new');
      const clientId = randomUUID();
      const sendAck = await new Promise<{ ok: boolean; data?: { id: string; status: string } }>((resolve) => {
        aliceSocket.emit('message:send', { conversationId: convId, content: 'Hello Bob!', clientId }, resolve);
      });
      expect(sendAck.ok).toBe(true);
      expect(sendAck.data?.status).toBe('sent');

      const received = await bobReceivePromise;
      expect(received.content).toBe('Hello Bob!');

      // Bob acknowledges delivery -> Alice receives receipt:update (delivered)
      const deliveredPromise = waitForEvent<{ status: string; messageIds: string[] }>(aliceSocket, 'receipt:update');
      bobSocket.emit('message:delivered', { messageIds: [received.id] });
      const deliveredEvt = await deliveredPromise;
      expect(deliveredEvt.status).toBe('delivered');
      expect(deliveredEvt.messageIds).toContain(received.id);

      // Bob marks conversation read -> Alice receives receipt:update (read)
      const readPromise = waitForEvent<{ status: string; messageIds: string[] }>(aliceSocket, 'receipt:update');
      bobSocket.emit('conversation:read', { conversationId: convId, messageId: received.id });
      const readEvt = await readPromise;
      expect(readEvt.status).toBe('read');

      // Message persists on REST reload with status 'read'
      const history = await request(app).get(`/api/conversations/${convId}/messages`).set(alice.auth);
      expect(history.status).toBe(200);
      expect(history.body.data[0].content).toBe('Hello Bob!');
      expect(history.body.data[0].status).toBe('read');
    } finally {
      aliceSocket.close();
      bobSocket.close();
      carolSocket.close();
    }
  });

  it('enforces group RBAC (OWNER / ADMIN / MEMBER) and ownership transfer on leave', async () => {
    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const carol = await registerUser('carol');

    const groupRes = await request(app)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ type: 'GROUP', name: 'Engineering', memberIds: [bob.id, carol.id] });
    expect(groupRes.status).toBe(201);
    const groupId = groupRes.body.data.id as string;

    // Member (Bob) cannot rename group
    const bobRename = await request(app).patch(`/api/conversations/${groupId}`).set(bob.auth).send({ name: 'Hacked' });
    expect(bobRename.status).toBe(403);

    // Owner (Alice) promotes Bob to ADMIN
    const promote = await request(app)
      .patch(`/api/conversations/${groupId}/members/${bob.id}`)
      .set(alice.auth)
      .send({ role: 'ADMIN' });
    expect(promote.status).toBe(200);
    expect(promote.body.data.role).toBe('ADMIN');

    // Admin (Bob) can rename group, but cannot remove Owner (Alice)
    const bobRenameOk = await request(app)
      .patch(`/api/conversations/${groupId}`)
      .set(bob.auth)
      .send({ name: 'Platform Engineering' });
    expect(bobRenameOk.status).toBe(200);

    const removeOwner = await request(app)
      .delete(`/api/conversations/${groupId}/members/${alice.id}`)
      .set(bob.auth);
    expect(removeOwner.status).toBe(403);

    // Owner leaves -> Bob (ADMIN) automatically becomes OWNER
    const leaveRes = await request(app).post(`/api/conversations/${groupId}/leave`).set(alice.auth);
    expect(leaveRes.status).toBe(204);

    const afterLeave = await request(app).get(`/api/conversations/${groupId}`).set(bob.auth);
    expect(afterLeave.status).toBe(200);
    expect(afterLeave.body.data.myRole).toBe('OWNER');
  });
});
