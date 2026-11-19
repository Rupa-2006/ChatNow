import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { uploadAttachmentMiddleware, uploadAvatarMiddleware } from '../../src/middleware/upload.js';
import { checkSocketRateLimit } from '../../src/sockets/rateLimit.js';

const app = createApp({ rateLimit: false });

describe('HTTP security headers & CORS policy', () => {
  it('sets hardened security headers and omits X-Powered-By', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('does not echo Access-Control-Allow-Origin for untrusted origins', async () => {
    const res = await request(app)
      .get('/api/nope')
      .set('Origin', 'https://evil-attacker.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows configured CORS origin with credentials', async () => {
    const res = await request(app)
      .get('/api/nope')
      .set('Origin', 'http://localhost:5174');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('Socket.IO per-user rate-limiting buckets', () => {
  it('enforces 20 message:send events per 10 s window per user', async () => {
    const uid = `rate-test-msg-${Date.now()}`;
    for (let i = 1; i <= 20; i += 1) {
      const res = await checkSocketRateLimit(uid, 'message');
      expect(res.allowed).toBe(true);
    }
    const over = await checkSocketRateLimit(uid, 'message');
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it('enforces 60 typing events per 60 s window per user', async () => {
    const uid = `rate-test-typing-${Date.now()}`;
    for (let i = 1; i <= 60; i += 1) {
      const res = await checkSocketRateLimit(uid, 'typing');
      expect(res.allowed).toBe(true);
    }
    expect((await checkSocketRateLimit(uid, 'typing')).allowed).toBe(false);
  });
});

describe('Upload size limit enforcement', () => {
  const uploadApp = express();
  uploadApp.post('/avatar', uploadAvatarMiddleware, (_req, res) => res.status(200).json({ ok: true }));
  uploadApp.post('/file', uploadAttachmentMiddleware, (_req, res) => res.status(200).json({ ok: true }));
  uploadApp.use(errorHandler);

  it('rejects avatar uploads larger than 2 MB with 413 PAYLOAD_TOO_LARGE', async () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1024, 0x41);
    const res = await request(uploadApp)
      .post('/avatar')
      .attach('file', oversized, 'big.png');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects attachment uploads larger than 10 MB with 413 PAYLOAD_TOO_LARGE', async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x41);
    const res = await request(uploadApp)
      .post('/file')
      .attach('file', oversized, 'huge.pdf');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
