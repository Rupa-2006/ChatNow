import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { conflict, invalidCredentials, notFound } from '../utils/errors.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../utils/password.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../utils/tokens.js';
import type { ChangePasswordInput, LoginInput, RegisterInput } from '../validators/auth.validators.js';
import { audit, type ClientMeta } from './audit.service.js';
import { flagSessionsRevoked } from './session.service.js';
import { meSelect, toMe, type Me } from './user.service.js';
import { disconnectUserSockets } from '../sockets/hub.js';

export type AuthTokens = { accessToken: string; refreshToken: string; refreshExpiresAt: Date };
export type AuthResult = AuthTokens & { user: Me };

/**
 * Two tabs can ask to refresh at the same instant with the same cookie. The second
 * request then presents a token the first one just rotated. Within this window that
 * is treated as a harmless race (rejected, but the session survives) rather than as
 * token theft.
 */
const ROTATION_GRACE_MS = 10_000;

const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

/** Creates a refresh-token row and the matching access token. */
async function issueTokens(
  userId: string,
  familyId: string,
  meta: ClientMeta,
  db: Prisma.TransactionClient = prisma,
): Promise<AuthTokens & { rowId: string }> {
  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = refreshExpiry();
  const row = await db.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      userAgent: meta.userAgent,
      ipAddress: meta.ip,
      expiresAt: refreshExpiresAt,
    },
    select: { id: true },
  });
  return { accessToken: signAccessToken(userId, familyId), refreshToken, refreshExpiresAt, rowId: row.id };
}

/** Revokes every live token in the given sessions and flags them so access tokens stop working too. */
async function revokeFamilies(where: Prisma.RefreshTokenWhereInput): Promise<string[]> {
  const live = await prisma.refreshToken.findMany({
    where: { ...where, revokedAt: null },
    select: { familyId: true },
    distinct: ['familyId'],
  });
  const familyIds = live.map((r) => r.familyId);
  if (familyIds.length === 0) return [];
  await prisma.refreshToken.updateMany({
    where: { familyId: { in: familyIds }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await flagSessionsRevoked(familyIds);
  return familyIds;
}

export async function register(input: RegisterInput, meta: ClientMeta): Promise<AuthResult> {
  // Pre-check for a helpful field-level message; the unique indexes below are what
  // actually guarantee uniqueness under concurrent requests.
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { username: input.username }] },
    select: { email: true, username: true },
  });
  if (existing) {
    const details = [];
    if (existing.email.toLowerCase() === input.email) details.push({ path: 'email', message: 'Email is already registered' });
    if (existing.username.toLowerCase() === input.username) details.push({ path: 'username', message: 'Username is already taken' });
    throw conflict('An account with those details already exists', details);
  }

  const passwordHash = await hashPassword(input.password);
  const familyId = randomUUID();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, username: input.username, displayName: input.displayName, passwordHash },
        select: meSelect,
      });
      const tokens = await issueTokens(user.id, familyId, meta, tx);
      return { user, tokens };
    });
    await audit({ action: 'auth.register', actorId: result.user.id, meta, metadata: { sessionId: familyId } });
    const { rowId: _rowId, ...tokens } = result.tokens;
    return { user: toMe(result.user), ...tokens };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('An account with those details already exists');
    }
    throw err;
  }
}

export async function login(input: LoginInput, meta: ClientMeta): Promise<AuthResult> {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: input.identifier }, { username: input.identifier }] },
    select: { ...meSelect, passwordHash: true },
  });

  if (!user) {
    // Do the same amount of work as a real check so timing does not reveal whether
    // the account exists, and return the same error as a wrong password.
    await verifyAgainstDummy(input.password);
    await audit({ action: 'auth.login.failure', meta, metadata: { reason: 'unknown_account' } });
    throw invalidCredentials();
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await audit({ action: 'auth.login.failure', actorId: user.id, meta, metadata: { reason: 'wrong_password' } });
    throw invalidCredentials();
  }

  const familyId = randomUUID();
  const { rowId: _rowId, ...tokens } = await issueTokens(user.id, familyId, meta);
  await audit({ action: 'auth.login.success', actorId: user.id, meta, metadata: { sessionId: familyId } });

  const { passwordHash: _passwordHash, ...safe } = user;
  return { user: toMe(safe), ...tokens };
}

export type RefreshResult =
  | ({ ok: true } & AuthTokens)
  /** `clearCookie` is false only for the concurrent-refresh race, where the browser already holds a newer cookie. */
  | { ok: false; clearCookie: boolean };

/**
 * Refresh-token rotation with reuse detection.
 *
 * Every refresh swaps the presented token for a new one and marks the old one
 * revoked. A revoked token turning up again means two parties hold tokens from the
 * same login — the legitimate browser and whoever copied it — and there is no way to
 * tell which is which. So the whole session is revoked and the real user signs in
 * again; the thief is left with nothing.
 */
export async function refresh(rawToken: string | undefined, meta: ClientMeta): Promise<RefreshResult> {
  if (!rawToken) return { ok: false, clearCookie: true };

  const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(rawToken) } });
  if (!current) return { ok: false, clearCookie: true };

  if (current.revokedAt) {
    // Never rotated: this was the newest token of a session that was closed (logout,
    // session revoked, password change, or an earlier theft response). That is an
    // ordinary sign-out, not evidence of theft, so it must not raise another alert.
    if (current.replacedById === null) return { ok: false, clearCookie: true };

    const rotatedJustNow = Date.now() - current.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (rotatedJustNow) return { ok: false, clearCookie: false };

    const revoked = await revokeFamilies({ familyId: current.familyId });
    await audit({
      action: 'auth.refresh.reuse_detected',
      actorId: current.userId,
      meta,
      metadata: { sessionId: current.familyId, sessionWasActive: revoked.length > 0 },
    });
    return { ok: false, clearCookie: true };
  }

  if (current.expiresAt.getTime() <= Date.now()) return { ok: false, clearCookie: true };

  const tokens = await prisma.$transaction(async (tx) => {
    // The `revokedAt: null` condition makes the claim atomic: if two requests race,
    // exactly one UPDATE matches a row and the other sees count = 0.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) return null;

    const next = await issueTokens(current.userId, current.familyId, meta, tx);
    await tx.refreshToken.update({ where: { id: current.id }, data: { replacedById: next.rowId } });
    return next;
  });

  if (!tokens) return { ok: false, clearCookie: false };
  const { rowId: _rowId, ...rest } = tokens;
  return { ok: true, ...rest };
}

export async function logout(rawToken: string | undefined, meta: ClientMeta): Promise<void> {
  if (!rawToken) return;
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    select: { familyId: true, userId: true },
  });
  if (!token) return;
  await revokeFamilies({ familyId: token.familyId });
  await disconnectUserSockets(token.userId, 'logout', token.familyId);
  await audit({ action: 'auth.logout', actorId: token.userId, meta, metadata: { sessionId: token.familyId } });
}

export async function logoutAll(userId: string, meta: ClientMeta): Promise<void> {
  const revoked = await revokeFamilies({ userId });
  await disconnectUserSockets(userId, 'logout_all');
  await audit({ action: 'auth.logout_all', actorId: userId, meta, metadata: { sessions: revoked.length } });
}

export type SessionInfo = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
};

export async function listSessions(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
  const [live, firsts] = await Promise.all([
    // The one un-revoked token of each session is its most recent activity.
    prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true, userAgent: true, ipAddress: true, createdAt: true },
    }),
    prisma.refreshToken.groupBy({ by: ['familyId'], where: { userId }, _min: { createdAt: true } }),
  ]);
  const startedAt = new Map(firsts.map((f) => [f.familyId, f._min.createdAt]));

  return live.map((t) => ({
    id: t.familyId,
    userAgent: t.userAgent,
    ipAddress: t.ipAddress,
    createdAt: (startedAt.get(t.familyId) ?? t.createdAt).toISOString(),
    lastActiveAt: t.createdAt.toISOString(),
    current: t.familyId === currentSessionId,
  }));
}

export async function revokeSession(userId: string, sessionId: string, meta: ClientMeta): Promise<void> {
  // Scoped by userId: one user can never revoke (or probe for) another user's session.
  const revoked = await revokeFamilies({ userId, familyId: sessionId });
  if (revoked.length === 0) throw notFound('Session');
  await disconnectUserSockets(userId, 'session_revoked', sessionId);
  await audit({ action: 'auth.session.revoked', actorId: userId, meta, metadata: { sessionId } });
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  input: ChangePasswordInput,
  meta: ClientMeta,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) throw notFound('User');

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    await audit({ action: 'auth.password.change_failed', actorId: userId, meta });
    throw invalidCredentials();
  }

  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.newPassword) } });
  // Anyone else signed in with the old password is signed out; this device stays in.
  const revoked = await revokeFamilies({ userId, familyId: { not: currentSessionId } });
  await disconnectUserSockets(userId, 'password_changed', undefined, currentSessionId);
  await audit({ action: 'auth.password.changed', actorId: userId, meta, metadata: { otherSessionsRevoked: revoked.length } });
}
