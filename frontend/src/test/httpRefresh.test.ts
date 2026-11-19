import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAccessToken,
  http,
  onSessionExpired,
  readTokenExpiry,
  refreshClient,
  setAccessToken,
} from '@/services/http';

/** An unsigned JWT-shaped string with the given expiry; the client never verifies signatures. */
function fakeJwt(expiresInMs: number): string {
  const b64url = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const exp = Math.floor((Date.now() + expiresInMs) / 1000);
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', sid: 's1', exp })}.sig`;
}

describe('proactive access-token renewal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    setAccessToken(null);
    refreshClient.defaults.adapter = undefined;
    vi.useRealTimers();
  });

  it('reads the expiry from a token and ignores malformed ones', () => {
    const token = fakeJwt(15 * 60_000);
    expect(readTokenExpiry(token)).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(readTokenExpiry('not-a-jwt')).toBeNull();
    expect(readTokenExpiry('a.!!!.c')).toBeNull();
  });

  it('renews before expiry without any API call failing first', async () => {
    let renewed = '';
    const calls: string[] = [];
    refreshClient.defaults.adapter = async (config) => {
      calls.push(config.url ?? '');
      renewed = fakeJwt(15 * 60_000); // like the server: a fresh 15-minute token
      return { data: { data: { accessToken: renewed } }, status: 200, statusText: 'OK', headers: {}, config };
    };

    setAccessToken(fakeJwt(15 * 60_000));

    // Nothing happens early on: renewal waits until 60–90 s before expiry.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toEqual([]);

    // By 14 minutes it has renewed exactly once and stored the new token.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(calls).toEqual(['/auth/refresh']);
    expect(getAccessToken()).toBe(renewed);
  });

  it('cancels the pending renewal when the session is cleared', async () => {
    const calls: string[] = [];
    refreshClient.defaults.adapter = async (config) => {
      calls.push(config.url ?? '');
      return { data: { data: { accessToken: 'x' } }, status: 200, statusText: 'OK', headers: {}, config };
    };
    setAccessToken(fakeJwt(15 * 60_000));
    setAccessToken(null); // sign-out
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(calls).toEqual([]);
  });
});

describe('http auth token and error normalization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setAccessToken(null);
    onSessionExpired(null);
  });

  it('attaches Bearer token from in-memory storage on outgoing requests', async () => {
    setAccessToken('test-jwt-123');
    let capturedAuth: string | undefined;

    const res = await http.get('/ping', {
      adapter: async (config) => {
        capturedAuth = config.headers?.get?.('Authorization') as string | undefined;
        return {
          data: { data: { ok: true } },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });

    expect(res.status).toBe(200);
    expect(capturedAuth).toBe('Bearer test-jwt-123');
    expect(getAccessToken()).toBe('test-jwt-123');
  });

  it('normalizes backend error envelopes into ApiError instances', async () => {
    await expect(
      http.post(
        '/auth/login',
        { identifier: 'alice', password: 'wrong' },
        {
          adapter: async (config) => {
            const err = Object.assign(new Error('Request failed with status code 401'), {
              isAxiosError: true,
              config,
              response: {
                status: 401,
                statusText: 'Unauthorized',
                headers: {},
                config,
                data: {
                  error: {
                    code: 'INVALID_CREDENTIALS',
                    message: 'Invalid email/username or password',
                    requestId: 'req-abc',
                  },
                },
              },
            });
            throw err;
          },
        },
      ),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INVALID_CREDENTIALS',
      status: 401,
      message: 'Invalid email/username or password',
      requestId: 'req-abc',
    });
  });
});
