import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachSocketServer, type AttachedSocketServer } from '../../src/sockets/index.js';
import { app, closeConnections, registerUser, resetState, type TestUser } from './helpers.js';

/**
 * Members see only messages sent during their current membership. Someone added (or
 * re-added) to a group must not be able to read earlier messages through ANY route:
 * history, search, reply quotes, reactions, files, previews, unread counts or sockets.
 */

let httpServer: HttpServer;
let attached: AttachedSocketServer;
let baseUrl: string;

function connectSocket(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioClient(baseUrl, { transports: ['websocket'], auth: { token }, reconnection: false });
    client.once('connect', () => resolve(client));
    client.once('connect_error', (err) => {
      client.close();
      reject(err);
    });
  });
}

function nextEvent<T>(socket: ClientSocket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

async function send(user: TestUser, convId: string, content: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/conversations/${convId}/messages`)
    .set(user.auth)
    .send({ content, clientId: randomUUID(), ...extra });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; replyTo: { content: string; hidden?: boolean } | null };
}

const contents = (res: request.Response) => (res.body.data as { content: string }[]).map((m) => m.content);

describe('message history visibility for added and re-added members', () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let convId: string;
  let earlyMsgId: string;
  let earlyAttachmentId: string;

  beforeAll(async () => {
    httpServer = createServer(app);
    attached = await attachSocketServer(httpServer, { offlineGraceMs: 100, useRedisAdapter: false });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await attached.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await closeConnections();
  });

  beforeEach(async () => {
    await resetState();
    alice = await registerUser('alice');
    bob = await registerUser('bob');
    carol = await registerUser('carol');

    const group = await request(app)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ type: 'GROUP', name: 'Team', memberIds: [bob.id] });
    convId = group.body.data.id;

    // Sent BEFORE Carol is added: she must never see any of this.
    const upload = await request(app)
      .post('/api/attachments')
      .set(alice.auth)
      .attach('file', PNG_1x1, { filename: 'early.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    earlyAttachmentId = upload.body.data.id;
    earlyMsgId = (await send(alice, convId, 'early secret before carol', { attachmentIds: [earlyAttachmentId] })).id;
    await send(bob, convId, 'another early secret');

    const add = await request(app).post(`/api/conversations/${convId}/members`).set(alice.auth).send({ userIds: [carol.id] });
    expect(add.status).toBe(200);
  });

  it('a newly added member sees only messages sent after joining', async () => {
    await send(alice, convId, 'hello carol');

    const res = await request(app).get(`/api/conversations/${convId}/messages`).set(carol.auth);
    expect(res.status).toBe(200);
    expect(contents(res)).toEqual(['hello carol']);

    // Existing members still see the full history.
    const forBob = await request(app).get(`/api/conversations/${convId}/messages`).set(bob.auth);
    expect(contents(forBob)).toEqual(['hello carol', 'another early secret', 'early secret before carol']);
  });

  it('hides earlier messages from search, in the conversation and across all chats', async () => {
    const inConv = await request(app).get(`/api/conversations/${convId}/messages/search?q=secret`).set(carol.auth);
    expect(inConv.status).toBe(200);
    expect(inConv.body.data).toEqual([]);

    const global = await request(app).get('/api/messages/search?q=secret').set(carol.auth);
    expect(global.body.data).toEqual([]);

    const forBob = await request(app).get('/api/messages/search?q=secret').set(bob.auth);
    expect(forBob.body.data).toHaveLength(2);
  });

  it('treats earlier messages as not found for every direct action', async () => {
    const jump = await request(app).get(`/api/conversations/${convId}/messages?around=${earlyMsgId}`).set(carol.auth);
    expect(jump.status).toBe(404);

    const react = await request(app).put(`/api/messages/${earlyMsgId}/reactions`).set(carol.auth).send({ emoji: '👍' });
    expect(react.status).toBe(404);

    const read = await request(app).post(`/api/conversations/${convId}/read`).set(carol.auth).send({ messageId: earlyMsgId });
    expect(read.status).toBe(404);

    const reply = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set(carol.auth)
      .send({ content: 'quoting something I cannot see', clientId: randomUUID(), replyToId: earlyMsgId });
    expect(reply.status).toBe(400);
  });

  it('blocks earlier files: no download and nothing in shared media', async () => {
    const download = await request(app).get(`/api/attachments/${earlyAttachmentId}/download`).set(carol.auth);
    expect(download.status).toBe(404);

    const media = await request(app).get(`/api/conversations/${convId}/attachments`).set(carol.auth);
    expect(media.body.data).toEqual([]);

    // Bob, a member when it was shared, can still download it.
    expect((await request(app).get(`/api/attachments/${earlyAttachmentId}/download`).set(bob.auth)).status).toBe(200);
  });

  it('shows no preview, last-activity time or unread count from before joining', async () => {
    const list = await request(app).get('/api/conversations').set(carol.auth);
    const team = list.body.data.find((c: { id: string }) => c.id === convId);
    expect(team.lastMessage).toBeNull();
    expect(team.lastMessageAt).toBeNull();
    expect(team.unreadCount).toBe(0);

    await send(alice, convId, 'first visible');
    const after = (await request(app).get(`/api/conversations/${convId}`).set(carol.auth)).body.data;
    expect(after.lastMessage.content).toBe('first visible');
    expect(after.unreadCount).toBe(1);
  });

  it('withholds the quote when a reply quotes a message from before the viewer joined', async () => {
    const carolSocket = await connectSocket(carol.accessToken);
    const bobSocket = await connectSocket(bob.accessToken);
    try {
      const carolGets = nextEvent<{ replyTo: { content: string; hidden?: boolean } }>(carolSocket, 'message:new');
      const bobGets = nextEvent<{ replyTo: { content: string; hidden?: boolean } }>(bobSocket, 'message:new');

      const sent = await send(alice, convId, 'replying to the early one', { replyToId: earlyMsgId });
      expect(sent.replyTo).toMatchObject({ content: 'early secret before carol' });

      // Live: Carol receives a redacted copy, Bob the normal one.
      expect((await carolGets).replyTo).toMatchObject({ content: '', hidden: true });
      expect((await bobGets).replyTo).toMatchObject({ content: 'early secret before carol' });

      // History: the same rule applies when loading messages.
      const history = await request(app).get(`/api/conversations/${convId}/messages`).set(carol.auth);
      expect(history.body.data[0]).toMatchObject({
        content: 'replying to the early one',
        replyTo: { content: '', hidden: true },
      });
      expect(JSON.stringify(history.body)).not.toContain('early secret before carol');
    } finally {
      carolSocket.close();
      bobSocket.close();
    }
  });

  it('a re-added member cannot read what was said while they were removed, or before', async () => {
    await send(alice, convId, 'carol era message');
    expect(contents(await request(app).get(`/api/conversations/${convId}/messages`).set(carol.auth))).toEqual([
      'carol era message',
    ]);

    await request(app).delete(`/api/conversations/${convId}/members/${carol.id}`).set(alice.auth).expect(204);
    await send(alice, convId, 'said while carol was out');
    await request(app).post(`/api/conversations/${convId}/members`).set(alice.auth).send({ userIds: [carol.id] }).expect(200);
    await send(bob, convId, 'welcome back carol');

    const res = await request(app).get(`/api/conversations/${convId}/messages`).set(carol.auth);
    expect(contents(res)).toEqual(['welcome back carol']);
    expect(JSON.stringify(res.body)).not.toContain('said while carol was out');

    const search = await request(app).get(`/api/conversations/${convId}/messages/search?q=carol`).set(carol.auth);
    expect(contents(search)).toEqual(['welcome back carol']);
  });

  it('broadcasts group updates without the editor\'s personal fields', async () => {
    await request(app).patch(`/api/conversations/${convId}/members/${bob.id}`).set(alice.auth).send({ role: 'ADMIN' }).expect(200);
    const carolSocket = await connectSocket(carol.accessToken);
    try {
      const update = nextEvent<Record<string, unknown>>(carolSocket, 'conversation:updated');
      await request(app).patch(`/api/conversations/${convId}`).set(bob.auth).send({ name: 'Renamed' }).expect(200);
      const payload = await update;
      expect(payload).toMatchObject({ id: convId, name: 'Renamed' });
      for (const personal of ['myRole', 'unreadCount', 'mutedUntil', 'lastMessage', 'lastMessageAt']) {
        expect(payload).not.toHaveProperty(personal);
      }
    } finally {
      carolSocket.close();
    }
  });
});
