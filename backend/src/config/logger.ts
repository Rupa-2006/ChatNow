import net from 'node:net';
import { Writable } from 'node:stream';
import pino from 'pino';
import { env } from './env.js';

/**
 * Structured JSON logger.
 *
 * `redact` is the last line of defence against secrets reaching the logs (and from
 * there Elasticsearch): any matching key is replaced before the line is written,
 * whatever the calling code passed in. Message `content` is on the list too — private
 * messages are never logged.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'content',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.tokenHash',
  '*.content',
];

/**
 * Non-blocking TCP NDJSON stream to Logstash.
 * Drops lines cleanly while disconnected or under backpressure so an unavailable ELK
 * stack can never slow down or crash the API process.
 */
export function createLogstashStream(host: string, port: number): Writable {
  let socket: net.Socket | null = null;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5_000);
    reconnectTimer.unref();
  };

  const connect = () => {
    if (closed) return;
    const sock = net.createConnection({ host, port });
    sock.setKeepAlive(true, 15_000);
    sock.on('connect', () => {
      connected = true;
    });
    sock.on('error', () => {
      connected = false;
    });
    sock.on('close', () => {
      connected = false;
      socket = null;
      scheduleReconnect();
    });
    sock.unref();
    socket = sock;
  };

  connect();

  return new Writable({
    write(chunk, _encoding, callback) {
      if (connected && socket && !socket.destroyed && socket.writableLength < 256 * 1024) {
        socket.write(chunk);
      }
      callback();
    },
    final(callback) {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.end();
      callback();
    },
  });
}

const pinoOptions: pino.LoggerOptions = {
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'chatnow-api', instance: env.INSTANCE_ID, env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
};

function buildLogger(): pino.Logger {
  if (env.LOGSTASH_HOST && !env.isTest) {
    const streams: pino.StreamEntry[] = [
      { stream: process.stdout },
      { stream: createLogstashStream(env.LOGSTASH_HOST, env.LOGSTASH_PORT) },
    ];
    return pino(pinoOptions, pino.multistream(streams));
  }

  if (env.NODE_ENV === 'development') {
    return pino({
      ...pinoOptions,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    });
  }

  return pino(pinoOptions);
}

export const logger = buildLogger();
