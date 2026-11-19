import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/authenticate.js';
import * as authService from '../services/auth.service.js';
import { getMe } from '../services/user.service.js';
import { refreshInvalid } from '../utils/errors.js';
import { clientMeta } from '../utils/request.js';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  sessionIdParamSchema,
} from '../validators/auth.validators.js';

export const REFRESH_COOKIE = 'chatnow_rt';

/**
 * - httpOnly: JavaScript cannot read the cookie, so XSS cannot steal the refresh token.
 * - secure:   only sent over HTTPS (off for http://localhost development).
 * - sameSite: 'strict' — never attached to requests started by another site (CSRF).
 * - path:     only sent to the auth endpoints, not with every API call.
 */
const cookieBase: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SAME_SITE === 'none' ? true : env.cookieSecure,
  sameSite: env.COOKIE_SAME_SITE,
  path: '/api/auth',
};

function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, { ...cookieBase, expires });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieBase);
}

const readRefreshCookie = (req: Request): string | undefined => {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export async function register(req: Request, res: Response): Promise<void> {
  const input = registerSchema.parse(req.body);
  const { user, accessToken, refreshToken, refreshExpiresAt } = await authService.register(input, clientMeta(req));
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  res.status(201).json({ data: { user, accessToken } });
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const { user, accessToken, refreshToken, refreshExpiresAt } = await authService.login(input, clientMeta(req));
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  res.json({ data: { user, accessToken } });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const result = await authService.refresh(readRefreshCookie(req), clientMeta(req));
  if (!result.ok) {
    if (result.clearCookie) clearRefreshCookie(res);
    throw refreshInvalid();
  }
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
  res.json({ data: { accessToken: result.accessToken } });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(readRefreshCookie(req), clientMeta(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  await authService.logoutAll(requireAuth(req).userId, clientMeta(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json({ data: await getMe(requireAuth(req).userId) });
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const { userId, sessionId } = requireAuth(req);
  res.json({ data: await authService.listSessions(userId, sessionId) });
}

export async function revokeSession(req: Request, res: Response): Promise<void> {
  const { id } = sessionIdParamSchema.parse(req.params);
  const { userId, sessionId } = requireAuth(req);
  await authService.revokeSession(userId, id, clientMeta(req));
  if (id === sessionId) clearRefreshCookie(res);
  res.status(204).end();
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const input = changePasswordSchema.parse(req.body);
  const { userId, sessionId } = requireAuth(req);
  await authService.changePassword(userId, sessionId, input, clientMeta(req));
  res.status(204).end();
}
