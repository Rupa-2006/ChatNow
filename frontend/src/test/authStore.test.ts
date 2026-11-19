import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as authApi from '@/services/auth.api';
import * as httpModule from '@/services/http';
import { useAuthStore } from '@/store/authStore';
import type { Me } from '@/types/api';

const ALICE: Me = {
  id: '11111111-1111-1111-1111-111111111111',
  username: 'alice',
  displayName: 'Alice Johnson',
  email: 'alice@example.com',
  avatarUrl: null,
  bio: 'Distributed systems enthusiast',
  isOnline: true,
  lastSeenAt: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  notificationPrefs: { browser: true, sound: true, messagePreview: true },
};

describe('authStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    httpModule.setAccessToken(null);
    useAuthStore.setState({ status: 'bootstrapping', user: null, bootstrapped: false });
  });

  it('stores access token strictly in memory (never localStorage) on login', async () => {
    vi.spyOn(authApi, 'loginUser').mockResolvedValue({
      user: ALICE,
      accessToken: 'jwt-in-memory-token',
    });

    await useAuthStore.getState().login({ identifier: 'alice', password: 'correct horse battery' });

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.username).toBe('alice');
    expect(httpModule.getAccessToken()).toBe('jwt-in-memory-token');
    expect(localStorage.length).toBe(0);
  });

  it('restores session on reload via silent refresh + /auth/me', async () => {
    vi.spyOn(httpModule, 'performSilentRefresh').mockResolvedValue('rotated-access-token');
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue(ALICE);

    await useAuthStore.getState().bootstrap();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe(ALICE.id);
    expect(useAuthStore.getState().bootstrapped).toBe(true);
  });

  it('marks unauthenticated when silent refresh returns null', async () => {
    vi.spyOn(httpModule, 'performSilentRefresh').mockResolvedValue(null);

    await useAuthStore.getState().bootstrap();

    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('clears in-memory token and state on logout', async () => {
    httpModule.setAccessToken('active-jwt');
    useAuthStore.setState({ status: 'authenticated', user: ALICE, bootstrapped: true });
    vi.spyOn(authApi, 'logoutUser').mockResolvedValue();

    await useAuthStore.getState().logout();

    expect(httpModule.getAccessToken()).toBeNull();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(useAuthStore.getState().user).toBeNull();
  });
});
