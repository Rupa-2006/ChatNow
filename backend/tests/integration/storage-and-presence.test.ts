import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { presenceKey, refreshSocketPresence, registerSocketPresence } from '../../src/services/presence.service.js';
import { databaseStorage } from '../../src/services/storage.service.js';
import { closeConnections, prisma, redis, resetState } from './helpers.js';

beforeEach(resetState);
afterAll(closeConnections);

describe('database file storage (STORAGE_DRIVER=database)', () => {
  it('returns exactly the bytes that were stored', async () => {
    const key = `files/${randomUUID()}.png`;
    const bytes = randomBytes(64 * 1024); // arbitrary binary, including zero bytes
    await databaseStorage.put(key, bytes, 'image/png');

    const back = await databaseStorage.get(key);
    expect(back).not.toBeNull();
    expect(Buffer.compare(back!, bytes)).toBe(0);

    const row = await prisma.storedFile.findUniqueOrThrow({ where: { key }, select: { sizeBytes: true, mimeType: true } });
    expect(row).toEqual({ sizeBytes: bytes.length, mimeType: 'image/png' });
  });

  it('returns null for a key that does not exist', async () => {
    expect(await databaseStorage.get('files/missing.png')).toBeNull();
  });

  it('never overwrites an existing file under the same key', async () => {
    const key = `avatars/${randomUUID()}.png`;
    await databaseStorage.put(key, Buffer.from('first'), 'image/png');
    await expect(databaseStorage.put(key, Buffer.from('second'), 'image/png')).rejects.toThrow();
    expect((await databaseStorage.get(key))!.toString()).toBe('first');
  });
});

describe('presence heartbeat', () => {
  it('costs a single Redis command while the user is online', async () => {
    await registerSocketPresence('user-1', 'socket-a');
    const callSpy = vi.spyOn(redis, 'expire');
    const multiSpy = vi.spyOn(redis, 'multi');

    await refreshSocketPresence('user-1', 'socket-a');

    expect(callSpy).toHaveBeenCalledTimes(1);
    expect(multiSpy).not.toHaveBeenCalled();
    expect(await redis.ttl(presenceKey('user-1'))).toBeGreaterThan(140);
    callSpy.mockRestore();
    multiSpy.mockRestore();
  });

  it('re-adds the socket if its presence entry vanished (for example a Redis restart)', async () => {
    await registerSocketPresence('user-2', 'socket-b');
    await redis.del(presenceKey('user-2'));

    await refreshSocketPresence('user-2', 'socket-b');

    expect(await redis.smembers(presenceKey('user-2'))).toEqual(['socket-b']);
    expect(await redis.ttl(presenceKey('user-2'))).toBeGreaterThan(140);
  });
});
