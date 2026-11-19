import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashRefreshToken } from '../../src/utils/tokens.js';
import {
  app,
  closeConnections,
  loginUser,
  PASSWORD,
  prisma,
  rawSetCookie,
  refreshCookie,
  registerUser,
  resetState,
} from './helpers.js';

beforeEach(resetState);
afterAll(closeConnections);

const refresh = (cookie: string) => request(app).post('/api/auth/refresh').set('Cookie', cookie);
const me = (token: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

describe('registration', () => {
  it('creates the account, returns tokens and sets a hardened refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'Alice@ChatNow.test', username: 'Alice', displayName: 'Alice', password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: 'alice@chatnow.test', username: 'alice', displayName: 'Alice' });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|chatnow_rt/);

    const cookie = rawSetCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
  });

  it('stores an Argon2id hash and only a hash of the refresh token', async () => {
    const user = await registerUser('alice');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.passwordHash).not.toContain(PASSWORD);

    const rawToken = user.cookie.split('=')[1]!;
    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.tokenHash).toBe(hashRefreshToken(rawToken));
    expect(tokens[0]!.tokenHash).not.toBe(rawToken);
  });

  it('rejects a duplicate email or username regardless of letter case', async () => {
    await registerUser('alice');
    const dupEmail = await request(app)
      .post('/api/auth/register')
      .send({ email: 'ALICE@chatnow.test', username: 'other', displayName: 'X', password: PASSWORD });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.details).toEqual([{ path: 'email', message: expect.any(String) }]);

    const dupName = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@chatnow.test', username: 'ALICE', displayName: 'X', password: PASSWORD });
    expect(dupName.status).toBe(409);
    expect(dupName.body.error.details).toEqual([{ path: 'username', message: expect.any(String) }]);
    expect(await prisma.user.count()).toBe(1);
  });

  it('lets only one of two simultaneous registrations for the same username succeed', async () => {
    const attempt = (n: number) =>
      request(app)
        .post('/api/auth/register')
        .send({ email: `race${n}@chatnow.test`, username: 'racer', displayName: 'R', password: PASSWORD });
    const statuses = (await Promise.all([attempt(1), attempt(2)])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.user.count({ where: { username: 'racer' } })).toBe(1);
  });
});

describe('login', () => {
  it('accepts the email or the username', async () => {
    const alice = await registerUser('alice');
    for (const identifier of [alice.email, 'alice', 'ALICE']) {
      const res = await loginUser(identifier);
      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(alice.id);
    }
  });

  it('gives an identical response for a wrong password and an unknown account', async () => {
    await registerUser('alice');
    const wrong = await loginUser('alice', 'definitely-wrong-pw');
    const unknown = await loginUser('nobody', 'definitely-wrong-pw');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect({ ...wrong.body.error, requestId: '' }).toEqual({ ...unknown.body.error, requestId: '' });
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('returns the profile for a valid access token', async () => {
    const alice = await registerUser('alice');
    const res = await me(alice.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: alice.id, email: alice.email });
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });
});

describe('refresh-token rotation', () => {
  it('issues a new access token and a different refresh cookie', async () => {
    const alice = await registerUser('alice');
    const res = await refresh(alice.cookie);
    expect(res.status).toBe(200);
    expect(refreshCookie(res)).not.toBe(alice.cookie);
    expect((await me(res.body.data.accessToken)).status).toBe(200);
  });

  it('treats an immediate replay as a race: rejected, but the session survives', async () => {
    const alice = await registerUser('alice');
    const first = await refresh(alice.cookie);
    const replay = await refresh(alice.cookie);
    expect(replay.status).toBe(401);
    expect(replay.headers['set-cookie']).toBeUndefined();
    expect((await refresh(refreshCookie(first))).status).toBe(200);
  });

  it('lets exactly one of two concurrent refreshes win', async () => {
    const alice = await registerUser('alice');
    const results = await Promise.all([refresh(alice.cookie), refresh(alice.cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    const live = await prisma.refreshToken.count({ where: { userId: alice.id, revokedAt: null } });
    expect(live).toBe(1);
  });

  it('revokes the whole session when a rotated token is reused later (theft detection)', async () => {
    const alice = await registerUser('alice');
    const rotated = await refresh(alice.cookie);
    const newCookie = refreshCookie(rotated);

    // Move the rotation outside the race-tolerance window.
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(alice.cookie.split('=')[1]!) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const reuse = await refresh(alice.cookie);
    expect(reuse.status).toBe(401);
    expect(rawSetCookie(reuse)).toMatch(/chatnow_rt=;/);

    // The legitimate holder's newer token and access token are dead too.
    expect((await refresh(newCookie)).status).toBe(401);
    expect((await me(rotated.body.data.accessToken)).status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: alice.id, revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh.reuse_detected' } })).toBe(1);
  });

  it('rejects an expired or unknown refresh token', async () => {
    const alice = await registerUser('alice');
    await prisma.refreshToken.updateMany({ where: { userId: alice.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refresh(alice.cookie)).status).toBe(401);
    expect((await refresh('chatnow_rt=made-up-value')).status).toBe(401);
  });
});

describe('logout and session management', () => {
  it('logout kills the refresh token and the access token immediately', async () => {
    const alice = await registerUser('alice');
    const out = await request(app).post('/api/auth/logout').set('Cookie', alice.cookie);
    expect(out.status).toBe(204);
    expect(rawSetCookie(out)).toMatch(/chatnow_rt=;/);
    expect((await refresh(alice.cookie)).status).toBe(401);
    expect((await me(alice.accessToken)).status).toBe(401);
    // Presenting a token after an ordinary logout is not theft and must not raise an alert.
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh.reuse_detected' } })).toBe(0);
  });

  it('logout-all ends every session of that user and nobody else', async () => {
    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const second = await loginUser('alice');

    const res = await request(app).post('/api/auth/logout-all').set(alice.auth);
    expect(res.status).toBe(204);
    expect((await me(alice.accessToken)).status).toBe(401);
    expect((await me(second.body.data.accessToken)).status).toBe(401);
    expect((await refresh(refreshCookie(second))).status).toBe(401);
    expect((await me(bob.accessToken)).status).toBe(200);
  });

  it('lists sessions and marks the current one', async () => {
    const alice = await registerUser('alice');
    await loginUser('alice');
    const res = await request(app).get('/api/auth/sessions').set(alice.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash/);
  });

  it('revokes one of your own sessions but never someone else\'s', async () => {
    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const second = await loginUser('alice');

    const sessions = (await request(app).get('/api/auth/sessions').set(alice.auth)).body.data;
    const other = sessions.find((s: { current: boolean }) => !s.current);

    const byBob = await request(app).delete(`/api/auth/sessions/${other.id}`).set(bob.auth);
    expect(byBob.status).toBe(404);
    expect((await me(second.body.data.accessToken)).status).toBe(200);

    const byAlice = await request(app).delete(`/api/auth/sessions/${other.id}`).set(alice.auth);
    expect(byAlice.status).toBe(204);
    expect((await me(second.body.data.accessToken)).status).toBe(401);
    expect((await me(alice.accessToken)).status).toBe(200);
  });
});

describe('change password', () => {
  it('requires the current password', async () => {
    const alice = await registerUser('alice');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(alice.auth)
      .send({ currentPassword: 'not-the-password', newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(401);
    expect((await loginUser('alice')).status).toBe(200);
  });

  it('switches the password, keeps this session and ends the others', async () => {
    const alice = await registerUser('alice');
    const other = await loginUser('alice');

    const res = await request(app)
      .post('/api/auth/change-password')
      .set(alice.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(204);

    expect((await loginUser('alice')).status).toBe(401);
    expect((await loginUser('alice', 'a-brand-new-password')).status).toBe(200);
    expect((await me(alice.accessToken)).status).toBe(200);
    expect((await me(other.body.data.accessToken)).status).toBe(401);
  });
});

describe('audit trail and health', () => {
  it('records auth events without any credential material', async () => {
    const alice = await registerUser('alice');
    await loginUser('alice');
    await loginUser('alice', 'definitely-wrong-pw');
    await loginUser('ghost', 'definitely-wrong-pw');

    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual([
      'auth.register',
      'auth.login.success',
      'auth.login.failure',
      'auth.login.failure',
    ]);
    expect(rows[2]!.actorId).toBe(alice.id);
    expect(rows[3]!.actorId).toBeNull();
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('definitely-wrong-pw');
    expect(dump).not.toContain(alice.cookie.split('=')[1]);
  });

  it('reports healthy when PostgreSQL and Redis are reachable', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });
});
