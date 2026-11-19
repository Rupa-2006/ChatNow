import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { logger } from './config/logger.js';

/**
 * Single-origin deployment: the API also serves the built React app, so the site, the
 * REST API and the WebSocket share one origin. That keeps the refresh cookie
 * first-party with SameSite=Strict (cross-site cookies are blocked by Safari, Firefox
 * and Brave) and needs no cross-origin rules at all.
 *
 * Not used in development (Vite) or Docker Compose (Nginx serves the frontend).
 */

/** SHA-256 hashes of inline <script> blocks, so the CSP can allow exactly those. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1] ?? '';
    if (body.trim()) hashes.push(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  return hashes;
}

export function mountFrontend(app: Express, distDir: string): void {
  const indexPath = path.join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`FRONTEND_DIST is set but ${indexPath} does not exist. Build the frontend first.`);
  }
  const indexHtml = readFileSync(indexPath, 'utf8');
  const scriptHashes = inlineScriptHashes(indexHtml);

  // A real page policy (the API's is "default-src 'none'"). Scripts: only our own files
  // plus the exact inline theme script by hash, never 'unsafe-inline'.
  const pageHeaders = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...scriptHashes],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  const isAppPath = (p: string) => !p.startsWith('/api/') && p !== '/api' && !p.startsWith('/socket.io');

  app.use((req: Request, res: Response, next: NextFunction) => (isAppPath(req.path) ? pageHeaders(req, res, next) : next()));

  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite fingerprints asset filenames, so they can be cached forever.
        const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
        res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );

  // Client-side routes (/chat, /profile, …) all load index.html.
  app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    if (!isAppPath(req.path) || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(indexHtml);
  });

  logger.info({ event: 'frontend.mounted', distDir, inlineScripts: scriptHashes.length }, 'Serving the frontend');
}
