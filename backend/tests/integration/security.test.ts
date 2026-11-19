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

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

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

describe('Phase 6 security boundaries, file spoofing, concurrency & WS abuse', () => {
  beforeAll(async () => {
    httpServer = createServer(app);
    attached = await attachSocketServer(httpServer, { offlineGraceMs: 100, useRedisAdapter: false });
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

  it('prevents IDOR across conversations, messages, search, attachments, and notifications', async () => {
    const alice = await registerUser('alice_sec');
    const bob = await registerUser('bob_sec');
    const mallory = await registerUser('mallory_sec');

    const convRes = await request(app)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ type: 'DIRECT', userId: bob.id });
    const convId = convRes.body.data.id as string;

    // Alice uploads a valid PNG and attaches it to a private message
    const upRes = await request(app)
      .post('/api/attachments')
      .set(alice.auth)
      .attach('file', VALID_PNG, 'secret.png');
    expect(upRes.status).toBe(201);
    const attachmentId = upRes.body.data.id as string;

    const msgRes = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set(alice.auth)
      .send({ content: 'confidential-token-xyz', clientId: randomUUID(), attachmentIds: [attachmentId] });
    expect(msgRes.status).toBe(201);
    const messageId = msgRes.body.data.id as string;

    // Mallory (non-member) is denied with 404 on every resource
    expect((await request(app).get(`/api/conversations/${convId}`).set(mallory.auth)).status).toBe(404);
    expect((await request(app).get(`/api/conversations/${convId}/messages`).set(mallory.auth)).status).toBe(404);
    expect(
      (await request(app).get(`/api/conversations/${convId}/messages/search?q=confidential`).set(mallory.auth)).status,
    ).toBe(404);
    expect((await request(app).get(`/api/attachments/${attachmentId}/download`).set(mallory.auth)).status).toBe(404);
    expect((await request(app).patch(`/api/messages/${messageId}`).set(mallory.auth).send({ content: 'pwn' })).status).toBe(
      404,
    );
    expect((await request(app).delete(`/api/messages/${messageId}`).set(mallory.auth)).status).toBe(404);

    // Mallory's global search must never return Alice & Bob's messages
    const globalSearch = await request(app).get('/api/messages/search?q=confidential').set(mallory.auth);
    expect(globalSearch.status).toBe(200);
    expect(globalSearch.body.data).toHaveLength(0);

    // Bob (authorized member) CAN download the attachment
    const bobDownload = await request(app).get(`/api/attachments/${attachmentId}/download`).set(bob.auth);
    expect(bobDownload.status).toBe(200);
    expect(bobDownload.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects spoofed HTML/SVG file uploads disguised as .png with 415', async () => {
    const alice = await registerUser('alice_upload');
    const res = await request(app)
      .post('/api/attachments')
      .set(alice.auth)
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('prevents blocked users from messaging or evading blocks via group creation', async () => {
    const alice = await registerUser('alice_blk');
    const bob = await registerUser('bob_blk');

    await request(app).post(`/api/users/${bob.id}/block`).set(alice.auth);

    // Bob cannot start a 1:1 chat with Alice
    const dmRes = await request(app)
      .post('/api/conversations')
      .set(bob.auth)
      .send({ type: 'DIRECT', userId: alice.id });
    expect(dmRes.status).toBe(403);

    // Bob cannot add Alice to a new group either (block-evasion defense)
    const grpRes = await request(app)
      .post('/api/conversations')
      .set(bob.auth)
      .send({ type: 'GROUP', name: 'Spam Group', memberIds: [alice.id] });
    expect(grpRes.status).toBe(403);
  });

  it('handles concurrent direct-chat creation, duplicate clientId sends, and parallel messaging safely', async () => {
    const alice = await registerUser('alice_conc');
    const bob = await registerUser('bob_conc');

    // Race two simultaneous 1:1 conversation creations
    const [r1, r2] = await Promise.all([
      request(app).post('/api/conversations').set(alice.auth).send({ type: 'DIRECT', userId: bob.id }),
      request(app).post('/api/conversations').set(bob.auth).send({ type: 'DIRECT', userId: alice.id }),
    ]);
    expect(r1.body.data.id).toBe(r2.body.data.id);
    const convId = r1.body.data.id as string;

    // Race two simultaneous sends with the exact same clientId (idempotency check)
    const sharedClientId = randomUUID();
    const [m1, m2] = await Promise.all([
      request(app)
        .post(`/api/conversations/${convId}/messages`)
        .set(alice.auth)
        .send({ content: 'Idempotent hello', clientId: sharedClientId }),
      request(app)
        .post(`/api/conversations/${convId}/messages`)
        .set(alice.auth)
        .send({ content: 'Idempotent hello', clientId: sharedClientId }),
    ]);
    expect(m1.body.data.id).toBe(m2.body.data.id);

    // Send 10 concurrent messages from both users simultaneously
    const sends = Array.from({ length: 10 }, (_, idx) => {
      const sender = idx % 2 === 0 ? alice : bob;
      return request(app)
        .post(`/api/conversations/${convId}/messages`)
        .set(sender.auth)
        .send({ content: `Parallel message #${idx}`, clientId: randomUUID() });
    });
    const results = await Promise.all(sends);
    for (const r of results) expect(r.status).toBe(201);

    const history = await request(app).get(`/api/conversations/${convId}/messages?limit=50`).set(alice.auth);
    expect(history.body.data).toHaveLength(11);
  });

  it('rate-limits abusive Socket.IO message floods and disconnects on sustained abuse', async () => {
    const alice = await registerUser('alice_flood');
    const bob = await registerUser('bob_flood');
    const convRes = await request(app)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ type: 'DIRECT', userId: bob.id });
    const convId = convRes.body.data.id as string;

    const sock = await connectSocket(alice.accessToken);
    const disconnected = new Promise<string>((resolve) => sock.once('disconnect', resolve));

    let rateLimitedCount = 0;
    for (let i = 0; i < 26; i += 1) {
      if (!sock.connected) break;
      const ack = await new Promise<{ ok: boolean; error?: { code: string } }>((resolve) => {
        sock.emit(
          'message:send',
          { conversationId: convId, content: `flood ${i}`, clientId: randomUUID() },
          resolve,
        );
      });
      if (!ack.ok && ack.error?.code === 'RATE_LIMITED') {
        rateLimitedCount += 1;
      }
    }

    expect(rateLimitedCount).toBeGreaterThanOrEqual(1);
    const reason = await disconnected;
    expect(reason).toBeTruthy();
    sock.close();
  });
});
