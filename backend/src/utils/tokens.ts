import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'chatnow';
const AUDIENCE = 'chatnow-api';

export type AccessClaims = {
  /** User id. */
  sub: string;
  /** Session id (the refresh-token family). Lets one session be revoked on its own. */
  sid: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
};

export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
}

/**
 * Returns the claims, or null for any invalid token (bad signature, expired, wrong
 * issuer/audience, wrong shape). `algorithms` is pinned so a token cannot choose its
 * own verification algorithm (the classic `alg: none` / algorithm-confusion attacks).
 */
export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === 'string') return null;
    const { sub, sid, exp } = payload as { sub?: unknown; sid?: unknown; exp?: unknown };
    if (typeof sub !== 'string' || typeof sid !== 'string' || typeof exp !== 'number') return null;
    return { sub, sid, exp };
  } catch {
    return null;
  }
}

/** 256 bits from the OS CSPRNG, URL-safe. This is the value placed in the cookie. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Only this hash is stored. A plain SHA-256 is sufficient (no salt or slow hash
 * needed) because the input is already 256 bits of randomness and cannot be guessed.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
