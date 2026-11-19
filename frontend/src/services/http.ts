import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import type { ApiSuccess, RefreshResponseData } from '@/types/api';
import { normalizeApiError } from '@/utils/errors';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';

/**
 * In-memory access token storage.
 * Kept strictly in module memory (never localStorage/sessionStorage) so XSS cannot
 * read a persisted credential across reloads. Reload persistence comes from the
 * HttpOnly SameSite=Strict refresh cookie via POST /api/auth/refresh.
 */
let memoryAccessToken: string | null = null;
let sessionExpiredListener: (() => void) | null = null;
let tokenRefreshedListener: ((token: string) => void) | null = null;
let inflightRefresh: Promise<string | null> | null = null;
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Renew this long before the access token expires (plus jitter, see below). */
export const REFRESH_LEAD_MS = 60_000;

export function getAccessToken(): string | null {
  return memoryAccessToken;
}

/**
 * Reads the `exp` claim (seconds since the epoch) without verifying the signature.
 * That is safe here: the value only decides *when* to renew; the server still
 * verifies every token it receives.
 */
export function readTokenExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Renews the access token shortly before it expires. Without this, a user who only
 * reads or chats over the WebSocket never triggers a REST 401, so the token was never
 * renewed and the server ended their session after 15 minutes.
 * The random jitter keeps several tabs of the same site from rotating the shared
 * refresh cookie at the same instant.
 */
function scheduleProactiveRefresh(token: string | null): void {
  if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer);
  proactiveRefreshTimer = null;
  if (!token) return;

  const expiresAt = readTokenExpiry(token);
  if (!expiresAt) return;
  const lead = REFRESH_LEAD_MS + Math.random() * 30_000;
  const delay = Math.max(5_000, expiresAt - Date.now() - lead);
  proactiveRefreshTimer = setTimeout(() => {
    proactiveRefreshTimer = null;
    void performSilentRefresh();
  }, delay);
}

export function setAccessToken(token: string | null): void {
  memoryAccessToken = token;
  scheduleProactiveRefresh(token);
}

export function onSessionExpired(listener: (() => void) | null): void {
  sessionExpiredListener = listener;
}

export function onTokenRefreshed(listener: ((token: string) => void) | null): void {
  tokenRefreshedListener = listener;
}

/**
 * Dedicated client without auth-retry interceptors, used exclusively for token refresh.
 * Exported only so tests can substitute its network adapter.
 */
export const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

export const http = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

function shouldSkipRefresh(url: string | undefined): boolean {
  if (!url) return false;
  return NO_REFRESH_PATHS.some((path) => url.includes(path));
}

/**
 * Single-flight refresh: concurrent 401 responses share one POST /api/auth/refresh
 * request so rotating refresh tokens are never submitted twice in parallel.
 */
export async function performSilentRefresh(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh;

  inflightRefresh = refreshClient
    .post<ApiSuccess<RefreshResponseData>>('/auth/refresh')
    .then((res) => {
      const nextToken = res.data.data.accessToken;
      setAccessToken(nextToken);
      tokenRefreshedListener?.(nextToken);
      return nextToken;
    })
    .catch(() => {
      setAccessToken(null);
      return null;
    })
    .finally(() => {
      inflightRefresh = null;
    });

  return inflightRefresh;
}

http.interceptors.request.use((config) => {
  if (memoryAccessToken) {
    const headers = AxiosHeaders.from(config.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${memoryAccessToken}`);
    }
    config.headers = headers;
  }
  return config;
});

type RetryableConfig = InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean };

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.config) {
      return Promise.reject(normalizeApiError(error));
    }

    const original = error.config as RetryableConfig;
    const status = error.response?.status;

    if (status === 401 && !original._retriedAfterRefresh && !shouldSkipRefresh(original.url)) {
      original._retriedAfterRefresh = true;
      const newToken = await performSilentRefresh();
      if (newToken) {
        const headers = AxiosHeaders.from(original.headers);
        headers.set('Authorization', `Bearer ${newToken}`);
        original.headers = headers;
        return http.request(original);
      }
      sessionExpiredListener?.();
    }

    return Promise.reject(normalizeApiError(error));
  },
);
