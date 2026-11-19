import type { NextFunction, Request, Response } from 'express';
import { isSessionRevoked } from '../services/session.service.js';
import { unauthenticated } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/tokens.js';

/**
 * Requires a valid `Authorization: Bearer <access token>` header.
 *
 * Verification is two steps:
 *  1. The JWT signature, expiry, issuer and audience (no database access needed).
 *  2. A Redis lookup that the session was not revoked since the token was issued.
 *     A JWT cannot be "un-issued", so without this a logged-out or stolen token
 *     would keep working until it expired.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.get('authorization');
  if (!header || !header.startsWith('Bearer ')) throw unauthenticated();

  const claims = verifyAccessToken(header.slice('Bearer '.length).trim());
  if (!claims) throw unauthenticated('Invalid or expired access token');

  if (await isSessionRevoked(claims.sid)) throw unauthenticated('Session has been revoked');

  req.auth = { userId: claims.sub, sessionId: claims.sid };
  next();
}

/** For use inside handlers that sit behind `authenticate`. */
export function requireAuth(req: Request): { userId: string; sessionId: string } {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
