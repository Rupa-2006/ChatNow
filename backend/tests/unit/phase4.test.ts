import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { makeDirectKey } from '../../src/services/conversation.service.js';
import { deriveMessageStatus, groupReactions } from '../../src/services/mappers.js';
import { isAllowedAvatarMime, sanitizeFilename, sniffFileContent } from '../../src/utils/fileSniff.js';
import { createConversationSchema, updateConversationSchema } from '../../src/validators/conversation.validators.js';
import { sendMessageSchema } from '../../src/validators/message.validators.js';
import { socketSendMessageSchema } from '../../src/validators/socket.validators.js';

const app = createApp({ rateLimit: false });
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('magic-byte file sniffing & upload security', () => {
  it('identifies a real PNG header and parses width/height', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    const result = sniffFileContent(png, 'photo.png');
    expect(result).toEqual({
      mimeType: 'image/png',
      extension: '.png',
      isImage: true,
      width: 640,
      height: 480,
    });
    expect(isAllowedAvatarMime(result!.mimeType)).toBe(true);
  });

  it('rejects spoofed HTML/SVG disguised with a .png extension', () => {
    const fakePng = Buffer.from('<svg onload="alert(1)"></svg>', 'utf8');
    expect(sniffFileContent(fakePng, 'avatar.png')).toBeNull();
  });

  it('rejects Windows PE executable disguised as .txt or .pdf', () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(sniffFileContent(exe, 'notes.txt')).toBeNull();
    expect(sniffFileContent(exe, 'report.pdf')).toBeNull();
  });

  it('accepts valid PDF and plain UTF-8 text files', () => {
    expect(sniffFileContent(Buffer.from('%PDF-1.7\nhello'), 'doc.pdf')?.mimeType).toBe('application/pdf');
    expect(sniffFileContent(Buffer.from('Hello ChatNow\n'), 'notes.txt')?.mimeType).toBe('text/plain');
    expect(sniffFileContent(Buffer.from('<h1>xss</h1>'), 'evil.html')).toBeNull();
  });

  it('strips path traversal and header injection from filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a"b\r\nc.png')).toBe('a_b__c.png');
  });
});

describe('Phase 4 validators and mappers', () => {
  it('computes order-independent directKey for user pairs', () => {
    expect(makeDirectKey(UUID_A, UUID_B)).toBe(makeDirectKey(UUID_B, UUID_A));
  });

  it('derives sent -> delivered -> read tick states for 1:1 and groups', () => {
    const now = new Date();
    expect(deriveMessageStatus([])).toBe('sent');
    expect(deriveMessageStatus([{ deliveredAt: null, readAt: null }])).toBe('sent');
    expect(deriveMessageStatus([{ deliveredAt: now, readAt: null }, { deliveredAt: null, readAt: null }])).toBe('sent');
    expect(deriveMessageStatus([{ deliveredAt: now, readAt: null }, { deliveredAt: now, readAt: now }])).toBe('delivered');
    expect(deriveMessageStatus([{ deliveredAt: now, readAt: now }, { deliveredAt: now, readAt: now }])).toBe('read');
  });

  it('groups reactions by emoji', () => {
    expect(
      groupReactions([
        { emoji: '👍', userId: UUID_A },
        { emoji: '🔥', userId: UUID_A },
        { emoji: '👍', userId: UUID_B },
      ]),
    ).toEqual([
      { emoji: '👍', userIds: [UUID_A, UUID_B] },
      { emoji: '🔥', userIds: [UUID_A] },
    ]);
  });

  it('requires content or attachments when sending a message', () => {
    expect(sendMessageSchema.safeParse({ content: '   ', clientId: UUID_A }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ content: '', clientId: UUID_A, attachmentIds: [UUID_B] }).success).toBe(true);
    expect(
      socketSendMessageSchema.safeParse({ conversationId: UUID_A, content: 'Hello!', clientId: UUID_B }).success,
    ).toBe(true);
  });

  it('validates direct and group conversation creation schemas', () => {
    expect(createConversationSchema.safeParse({ type: 'DIRECT', userId: UUID_A }).success).toBe(true);
    expect(createConversationSchema.safeParse({ type: 'GROUP', name: 'Core Team', memberIds: [UUID_A] }).success).toBe(
      true,
    );
    expect(createConversationSchema.safeParse({ type: 'GROUP', name: '', memberIds: [UUID_A] }).success).toBe(false);
    expect(updateConversationSchema.safeParse({}).success).toBe(false);
  });
});

describe('Phase 4 route authentication boundaries', () => {
  const routes: [string, string][] = [
    ['get', '/api/conversations'],
    ['post', '/api/conversations'],
    ['get', `/api/conversations/${UUID_A}`],
    ['patch', `/api/conversations/${UUID_A}`],
    ['post', `/api/conversations/${UUID_A}/members`],
    ['delete', `/api/conversations/${UUID_A}/members/${UUID_B}`],
    ['patch', `/api/conversations/${UUID_A}/members/${UUID_B}`],
    ['post', `/api/conversations/${UUID_A}/leave`],
    ['post', `/api/conversations/${UUID_A}/read`],
    ['get', `/api/conversations/${UUID_A}/attachments`],
    ['get', `/api/conversations/${UUID_A}/messages`],
    ['post', `/api/conversations/${UUID_A}/messages`],
    ['get', `/api/conversations/${UUID_A}/messages/search?q=hi`],
    ['get', '/api/messages/search?q=hi'],
    ['patch', `/api/messages/${UUID_A}`],
    ['delete', `/api/messages/${UUID_A}`],
    ['put', `/api/messages/${UUID_A}/reactions`],
    ['delete', `/api/messages/${UUID_A}/reactions/hi`],
    ['post', '/api/attachments'],
    ['get', `/api/attachments/${UUID_A}/download`],
    ['post', '/api/users/avatar'],
    ['get', '/api/notifications'],
    ['patch', `/api/notifications/${UUID_A}/read`],
    ['post', '/api/notifications/read-all'],
  ];

  it.each(routes)('%s %s rejects unauthenticated requests with 401', async (method, path) => {
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!(path);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects path-traversal avatar filenames with 404', async () => {
    const res = await request(app).get('/api/avatars/..%2Fpackage.json');
    expect(res.status).toBe(404);
  });
});
