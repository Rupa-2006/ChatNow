import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/utils/tokens.js';

/**
 * HTTP-level behaviour that needs neither PostgreSQL nor Redis: every request here is
 * rejected (or answered) before a handler would touch a data store.
 */
const app = createApp({ rateLimit: false });

describe('error envelope', () => {
  it('returns the documented 404 shape for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns field-level details for a validation failure', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad', username: 'x', displayName: '', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(['displayName', 'email', 'password', 'username']);
  });

  it('does not echo the submitted password back in a validation error', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.co', username: 'valid_name', displayName: 'A', password: 'tiny-pw' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('tiny-pw');
  });

  it('rejects malformed JSON with 400 instead of 500', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"identifier": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an oversized body with 413', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'a', password: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('authentication boundary', () => {
  const protectedRoutes: [string, string][] = [
    ['get', '/api/auth/me'],
    ['get', '/api/auth/sessions'],
    ['post', '/api/auth/logout-all'],
    ['post', '/api/auth/change-password'],
    ['get', '/api/users'],
    ['get', '/api/users/search?q=al'],
    ['get', '/api/users/blocks'],
    ['patch', '/api/users/profile'],
    ['get', '/api/users/6f1c2a7e-3b1d-4a6f-9c1e-2d3f4a5b6c7d'],
    ['post', '/api/users/6f1c2a7e-3b1d-4a6f-9c1e-2d3f4a5b6c7d/block'],
  ];

  it.each(protectedRoutes)('%s %s requires a token', async (method, path) => {
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!(path);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['garbage', 'Bearer not.a.jwt'],
    ['wrong scheme', `Basic ${Buffer.from('a:b').toString('base64')}`],
    ['empty bearer', 'Bearer '],
    ['tampered signature', `Bearer ${signAccessToken('6f1c2a7e-3b1d-4a6f-9c1e-2d3f4a5b6c7d', '6f1c2a7e-3b1d-4a6f-9c1e-2d3f4a5b6c7e').slice(0, -3)}abc`],
  ])('rejects a %s Authorization header', async (_name, header) => {
    const res = await request(app).get('/api/auth/me').set('Authorization', header);
    expect(res.status).toBe(401);
  });

  it('refresh without a cookie is rejected and clears the cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
    expect(String(res.headers['set-cookie'])).toMatch(/chatnow_rt=;/);
  });
});

describe('security headers and CORS', () => {
  it('sets hardening headers and hides the framework', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('allows the configured origin with credentials', async () => {
    const res = await request(app).options('/api/auth/login').set('Origin', 'http://localhost:5174').set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant access to any other origin', async () => {
    const res = await request(app).options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts a well-formed request id and replaces a malformed one', async () => {
    const ok = await request(app).get('/api/nope').set('X-Request-Id', 'trace-12345678');
    expect(ok.headers['x-request-id']).toBe('trace-12345678');
    const bad = await request(app).get('/api/nope').set('X-Request-Id', 'bad id\twith spaces');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('rate limiting', () => {
  it('blocks the 11th registration attempt from one address with 429', async () => {
    const limited = createApp({ rateLimit: true });
    const attempt = () => request(limited).post('/api/auth/register').send({});
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(400);

    const res = await attempt();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
