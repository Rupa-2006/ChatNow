import net from 'node:net';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createLogstashStream, REDACT_PATHS } from '../../src/config/logger.js';

describe('Phase 5 ELK TCP log shipping & redaction', () => {
  it('ships structured redacted JSON logs over TCP to Logstash without leaking secrets or message content', async () => {
    const received: string[] = [];
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        received.push(chunk.toString('utf8'));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    const stream = createLogstashStream('127.0.0.1', port);
    // Give TCP loopback a moment to complete handshake
    await new Promise((r) => setTimeout(r, 80));

    const log = pino(
      {
        base: { service: 'chatnow-api', instance: 'api-1' },
        redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      },
      stream,
    );

    log.info(
      {
        event: 'message.sent',
        userId: 'u-123',
        conversationId: 'c-456',
        content: 'TOP SECRET PRIVATE MESSAGE',
        accessToken: 'jwt-super-secret',
        password: 'plain-password',
      },
      'message dispatched',
    );

    await new Promise((r) => setTimeout(r, 100));
    stream.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const payload = received.join('');
    expect(payload).toContain('"event":"message.sent"');
    expect(payload).toContain('"instance":"api-1"');
    expect(payload).not.toContain('TOP SECRET PRIVATE MESSAGE');
    expect(payload).not.toContain('jwt-super-secret');
    expect(payload).not.toContain('plain-password');
    expect(payload).toContain('[REDACTED]');
  });
});
