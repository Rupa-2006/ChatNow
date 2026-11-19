import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { inlineScriptHashes } from '../../src/frontend.js';
import { resolveDiskPath } from '../../src/services/storage.service.js';

const THEME_SCRIPT = "\n      document.documentElement.dataset.theme = 'dark';\n    ";
const INDEX_HTML = `<!doctype html><html><head><script>${THEME_SCRIPT}</script>
<script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>`;

let dist: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  dist = mkdtempSync(path.join(tmpdir(), 'chatnow-dist-'));
  writeFileSync(path.join(dist, 'index.html'), INDEX_HTML);
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
  writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');
  app = createApp({ rateLimit: false, frontendDist: dist });
});

afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe('single-origin frontend serving', () => {
  it('serves index.html for client-side routes', async () => {
    for (const route of ['/', '/chat', '/settings/profile']) {
      const res = await request(app).get(route).set('Accept', 'text/html');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('gives pages a CSP that allows only our scripts and the exact inline theme script', async () => {
    const res = await request(app).get('/chat').set('Accept', 'text/html');
    const csp = res.headers['content-security-policy'] as string;
    const expectedHash = `'sha256-${createHash('sha256').update(THEME_SCRIPT).digest('base64')}'`;
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))!;
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain(expectedHash);
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('caches fingerprinted assets forever and everything else not at all', async () => {
    const asset = await request(app).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const icon = await request(app).get('/favicon.svg');
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it('keeps the API strict: JSON 404s and a deny-everything CSP, never the website', async () => {
    const res = await request(app).get('/api/does-not-exist').set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.text).not.toContain('<div id="root">');
  });

  it('still requires authentication on API routes', async () => {
    expect((await request(app).get('/api/users')).status).toBe(401);
  });

  it('refuses to start when the build is missing', () => {
    expect(() => createApp({ frontendDist: path.join(dist, 'nope') })).toThrow(/does not exist/);
  });
});

describe('inlineScriptHashes', () => {
  it('hashes inline scripts and ignores external ones and empty blocks', () => {
    const html = '<script>a()</script><script src="/x.js"></script><script type="module" src="/y.js"></script><script>  </script>';
    expect(inlineScriptHashes(html)).toEqual([`'sha256-${createHash('sha256').update('a()').digest('base64')}'`]);
  });
});

describe('disk storage keys', () => {
  it('stay inside the upload directory', () => {
    expect(resolveDiskPath('files/abc.png')).toMatch(/uploads[\\/]files[\\/]abc\.png$/);
    expect(resolveDiskPath('../../etc/passwd')).toBeNull();
    expect(resolveDiskPath('files/../../outside.png')).toBeNull();
  });
});
