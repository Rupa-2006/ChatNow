import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../../src/config/logger.js';

/** Builds a logger with the production redaction list that writes into memory. */
function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream);
  return { log, output: () => lines.join('') };
}

describe('log redaction', () => {
  it('never writes credentials, tokens or message content', () => {
    const { log, output } = capture();
    log.info(
      {
        password: 'hunter2-password',
        body: { password: 'nested-password', newPassword: 'nested-new', currentPassword: 'nested-current' },
        user: { passwordHash: '$argon2id$secret-hash' },
        auth: { accessToken: 'eyJ.access.token', refreshToken: 'raw-refresh-token', tokenHash: 'abc123hash' },
        message: { id: 'm1', content: 'a private message body' },
        req: { headers: { authorization: 'Bearer eyJ.header.token', cookie: 'chatnow_rt=cookie-secret' } },
        res: { headers: { 'set-cookie': ['chatnow_rt=set-cookie-secret'] } },
      },
      'event',
    );
    const text = output();
    for (const secret of [
      'hunter2-password',
      'nested-password',
      'nested-new',
      'nested-current',
      'secret-hash',
      'eyJ.access.token',
      'raw-refresh-token',
      'abc123hash',
      'a private message body',
      'eyJ.header.token',
      'cookie-secret',
      'set-cookie-secret',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[REDACTED]');
  });

  it('keeps the non-sensitive fields needed to investigate an event', () => {
    const { log, output } = capture();
    log.info({ event: 'message.sent', userId: 'u1', message: { id: 'm1', content: 'secret' } }, 'sent');
    const line = JSON.parse(output());
    expect(line).toMatchObject({ event: 'message.sent', userId: 'u1', message: { id: 'm1', content: '[REDACTED]' } });
  });
});
