import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';

export const app = createApp({ rateLimit: false });
export { prisma, redis };

/** Empties the test database and the test Redis database between tests. */
export async function resetState(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "StoredFile", "AuditLog", "Notification", "Attachment", "MessageReaction", "MessageReceipt", "Message", "ConversationMember", "Conversation", "UserBlock", "RefreshToken", "User" CASCADE',
  );
  await redis.flushdb();
}

export async function closeConnections(): Promise<void> {
  await prisma.$disconnect();
  await redis.quit();
}

/** Extracts "chatnow_rt=<value>" from a response, ready to send back as a Cookie header. */
export function refreshCookie(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = header?.find((c) => c.startsWith('chatnow_rt='));
  if (!line) throw new Error('Response did not set the refresh cookie');
  return line.split(';')[0]!;
}

export function rawSetCookie(res: request.Response): string {
  return ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).join('\n');
}

// Test-only password; these accounts exist only inside the throwaway test database.
export const PASSWORD = 'integration-test-pw';

export type TestUser = {
  id: string;
  username: string;
  email: string;
  accessToken: string;
  cookie: string;
  auth: { Authorization: string };
};

export async function registerUser(username: string, overrides: Record<string, string> = {}): Promise<TestUser> {
  const email = `${username}@chatnow.test`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, username, displayName: `${username} name`, password: PASSWORD, ...overrides });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const accessToken: string = res.body.data.accessToken;
  return {
    id: res.body.data.user.id,
    username,
    email,
    accessToken,
    cookie: refreshCookie(res),
    auth: { Authorization: `Bearer ${accessToken}` },
  };
}

export async function loginUser(identifier: string, password = PASSWORD) {
  return request(app).post('/api/auth/login').send({ identifier, password });
}
