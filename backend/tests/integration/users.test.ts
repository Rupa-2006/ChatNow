import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { presenceKey } from '../../src/services/presence.service.js';
import { app, closeConnections, prisma, redis, registerUser, resetState, type TestUser } from './helpers.js';

let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

beforeEach(async () => {
  await resetState();
  alice = await registerUser('alice');
  bob = await registerUser('bob');
  carol = await registerUser('carol');
});
afterAll(closeConnections);

const usernames = (res: request.Response) => res.body.data.map((u: { username: string }) => u.username);

describe('directory', () => {
  it('lists other users, never the caller, and never private fields', async () => {
    const res = await request(app).get('/api/users').set(alice.auth);
    expect(res.status).toBe(200);
    expect(usernames(res)).toEqual(['bob', 'carol']);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      ['avatarUrl', 'bio', 'displayName', 'id', 'isOnline', 'lastSeenAt', 'username'].sort(),
    );
  });

  it('pages through results with a cursor without repeats or gaps', async () => {
    const first = await request(app).get('/api/users?limit=1').set(alice.auth);
    expect(usernames(first)).toEqual(['bob']);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));

    const second = await request(app).get(`/api/users?limit=1&cursor=${first.body.meta.nextCursor}`).set(alice.auth);
    expect(usernames(second)).toEqual(['carol']);
    expect(second.body.meta.nextCursor).toBeNull();
  });

  it('fetches one user, with 404 for an unknown id and 400 for a malformed one', async () => {
    const ok = await request(app).get(`/api/users/${bob.id}`).set(alice.auth);
    expect(ok.body.data.username).toBe('bob');
    expect((await request(app).get('/api/users/6f1c2a7e-3b1d-4a6f-9c1e-2d3f4a5b6c7d').set(alice.auth)).status).toBe(404);
    expect((await request(app).get("/api/users/1' OR '1'='1").set(alice.auth)).status).toBe(400);
  });

  it('reports presence from Redis', async () => {
    await redis.sadd(presenceKey(bob.id), 'socket-1');
    const res = await request(app).get('/api/users').set(alice.auth);
    const byName = Object.fromEntries(res.body.data.map((u: { username: string; isOnline: boolean }) => [u.username, u.isOnline]));
    expect(byName).toEqual({ bob: true, carol: false });
  });
});

describe('search', () => {
  it('matches part of a username or display name, case-insensitively', async () => {
    await request(app).patch('/api/users/profile').set(carol.auth).send({ displayName: 'Dr. Robert Smith' });
    expect(usernames(await request(app).get('/api/users/search?q=BO').set(alice.auth))).toEqual(['bob']);
    expect(usernames(await request(app).get('/api/users/search?q=robert').set(alice.auth))).toEqual(['carol']);
    expect(usernames(await request(app).get('/api/users/search?q=ali').set(alice.auth))).toEqual([]);
  });

  it('treats % and _ as literal characters, not wildcards', async () => {
    expect(usernames(await request(app).get('/api/users/search?q=%25%25').set(alice.auth))).toEqual([]);
    expect(usernames(await request(app).get('/api/users/search?q=b_b').set(alice.auth))).toEqual([]);
  });

  it('is not injectable', async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent("'; DROP TABLE \"User\"; --")}`)
      .set(alice.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(await prisma.user.count()).toBe(3);
  });
});

describe('profile', () => {
  it('updates fields and merges notification preferences', async () => {
    const res = await request(app)
      .patch('/api/users/profile')
      .set(alice.auth)
      .send({ displayName: 'Alice J', bio: 'hello', notificationPrefs: { sound: false } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      displayName: 'Alice J',
      bio: 'hello',
      notificationPrefs: { browser: true, sound: false, messagePreview: true },
    });
  });

  it('refuses a username that is already taken', async () => {
    const res = await request(app).patch('/api/users/profile').set(alice.auth).send({ username: 'BOB' });
    expect(res.status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).username).toBe('alice');
  });

  it('ignores attempts to set fields that are not part of the profile', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
    const res = await request(app)
      .patch('/api/users/profile')
      .set(alice.auth)
      .send({ displayName: 'Still Alice', email: 'hijack@evil.test', passwordHash: 'x', id: bob.id });
    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
    expect(after.email).toBe(before.email);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.id).toBe(before.id);
  });
});

describe('blocking', () => {
  it('hides the blocker from the blocked user and withholds presence both ways', async () => {
    await prisma.user.update({ where: { id: alice.id }, data: { lastSeenAt: new Date() } });
    await redis.sadd(presenceKey(alice.id), 'socket-1');
    await redis.sadd(presenceKey(bob.id), 'socket-2');

    expect((await request(app).post(`/api/users/${bob.id}/block`).set(alice.auth)).status).toBe(204);

    // Bob can no longer find Alice.
    expect(usernames(await request(app).get('/api/users').set(bob.auth))).toEqual(['carol']);
    expect(usernames(await request(app).get('/api/users/search?q=alice').set(bob.auth))).toEqual([]);

    // A direct lookup still resolves, but reveals no presence.
    const direct = await request(app).get(`/api/users/${alice.id}`).set(bob.auth);
    expect(direct.body.data).toMatchObject({ isOnline: false, lastSeenAt: null });

    // Alice still sees Bob in the directory, also without presence.
    const fromAlice = await request(app).get(`/api/users/${bob.id}`).set(alice.auth);
    expect(fromAlice.body.data.isOnline).toBe(false);

    // Carol is unaffected.
    const fromCarol = await request(app).get(`/api/users/${alice.id}`).set(carol.auth);
    expect(fromCarol.body.data.isOnline).toBe(true);
  });

  it('lists blocks, is idempotent, and unblocks', async () => {
    await request(app).post(`/api/users/${bob.id}/block`).set(alice.auth);
    expect((await request(app).post(`/api/users/${bob.id}/block`).set(alice.auth)).status).toBe(204);
    expect(await prisma.userBlock.count()).toBe(1);

    expect(usernames(await request(app).get('/api/users/blocks').set(alice.auth))).toEqual(['bob']);
    expect(usernames(await request(app).get('/api/users/blocks').set(bob.auth))).toEqual([]);

    expect((await request(app).delete(`/api/users/${bob.id}/block`).set(alice.auth)).status).toBe(204);
    expect(usernames(await request(app).get('/api/users').set(bob.auth))).toEqual(['alice', 'carol']);
  });

  it('rejects blocking yourself or a user that does not exist', async () => {
    expect((await request(app).post(`/api/users/${alice.id}/block`).set(alice.auth)).status).toBe(400);
    expect(
      (await request(app).post('/api/users/6f1c2a7e-3b1d-4a6f-9c1e-2d3f4a5b6c7d/block').set(alice.auth)).status,
    ).toBe(404);
  });
});
