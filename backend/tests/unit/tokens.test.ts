import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/utils/tokens.js';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const base = { issuer: 'chatnow', audience: 'chatnow-api', subject: USER } as const;

describe('access tokens', () => {
  it('round-trips the user id and session id', () => {
    const claims = verifyAccessToken(signAccessToken(USER, SESSION));
    expect(claims).toMatchObject({ sub: USER, sid: SESSION });
    const lifetime = claims!.exp - Math.floor(Date.now() / 1000);
    expect(lifetime).toBeGreaterThan(env.JWT_ACCESS_TTL_SECONDS - 5);
    expect(lifetime).toBeLessThanOrEqual(env.JWT_ACCESS_TTL_SECONDS);
  });

  it('rejects a token whose payload was altered', () => {
    const [header, payload, signature] = signAccessToken(USER, SESSION).split('.') as [string, string, string];
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString());
    forged.sub = '99999999-9999-4999-8999-999999999999';
    const tampered = [header, Buffer.from(JSON.stringify(forged)).toString('base64url'), signature].join('.');
    expect(verifyAccessToken(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ sid: SESSION }, 'x'.repeat(48), { ...base, algorithm: 'HS256', expiresIn: 60 });
    expect(verifyAccessToken(token)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = jwt.sign({ sid: SESSION }, env.JWT_ACCESS_SECRET, { ...base, algorithm: 'HS256', expiresIn: -10 });
    expect(verifyAccessToken(token)).toBeNull();
  });

  it('rejects an unsigned "alg: none" token', () => {
    const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: USER, sid: SESSION, iss: 'chatnow', aud: 'chatnow-api', exp })}.`;
    expect(verifyAccessToken(token)).toBeNull();
  });

  it('rejects a different HMAC algorithm than the one pinned', () => {
    const token = jwt.sign({ sid: SESSION }, env.JWT_ACCESS_SECRET, { ...base, algorithm: 'HS512', expiresIn: 60 });
    expect(verifyAccessToken(token)).toBeNull();
  });

  it('rejects the wrong issuer or audience', () => {
    const sign = (o: jwt.SignOptions) =>
      jwt.sign({ sid: SESSION }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', subject: USER, expiresIn: 60, ...o });
    expect(verifyAccessToken(sign({ issuer: 'someone-else', audience: 'chatnow-api' }))).toBeNull();
    expect(verifyAccessToken(sign({ issuer: 'chatnow', audience: 'another-api' }))).toBeNull();
  });

  it('rejects a token without a session id, and plain garbage', () => {
    const token = jwt.sign({}, env.JWT_ACCESS_SECRET, { ...base, algorithm: 'HS256', expiresIn: 60 });
    expect(verifyAccessToken(token)).toBeNull();
    expect(verifyAccessToken('not-a-token')).toBeNull();
    expect(verifyAccessToken('')).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('are 256 bits, URL-safe and unique', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateRefreshToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    }
  });

  it('hash deterministically and never to the token itself', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).not.toContain(token);
    expect(hashRefreshToken(token)).not.toBe(hashRefreshToken(generateRefreshToken()));
  });
});
