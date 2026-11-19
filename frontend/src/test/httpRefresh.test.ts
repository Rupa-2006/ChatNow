import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAccessToken,
  http,
  onSessionExpired,
  setAccessToken,
} from '@/services/http';

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
