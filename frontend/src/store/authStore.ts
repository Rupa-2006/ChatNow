import { create } from 'zustand';
import * as authApi from '@/services/auth.api';
import { onSessionExpired, performSilentRefresh, setAccessToken } from '@/services/http';
import type { Me } from '@/types/api';

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: Me | null;
  bootstrapped: boolean;

  bootstrap: () => Promise<void>;
  login: (payload: authApi.LoginPayload) => Promise<Me>;
  register: (payload: authApi.RegisterPayload) => Promise<Me>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  setUser: (user: Me) => void;
  clearSession: () => void;
}

let bootstrapPromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'bootstrapping',
  user: null,
  bootstrapped: false,

  bootstrap: async () => {
    if (get().bootstrapped) return;
    if (bootstrapPromise) return bootstrapPromise;

    bootstrapPromise = (async () => {
      set({ status: 'bootstrapping' });
      try {
        // Attempt silent refresh using the HttpOnly cookie so page reloads stay signed in.
        const token = await performSilentRefresh();
        if (!token) {
          set({ status: 'unauthenticated', user: null, bootstrapped: true });
          return;
        }
        const me = await authApi.fetchMe();
        set({ status: 'authenticated', user: me, bootstrapped: true });
      } catch {
        setAccessToken(null);
        set({ status: 'unauthenticated', user: null, bootstrapped: true });
      } finally {
        bootstrapPromise = null;
      }
    })();

    return bootstrapPromise;
  },

  login: async (payload) => {
    const { user, accessToken } = await authApi.loginUser(payload);
    setAccessToken(accessToken);
    set({ status: 'authenticated', user, bootstrapped: true });
    return user;
  },

  register: async (payload) => {
    const { user, accessToken } = await authApi.registerUser(payload);
    setAccessToken(accessToken);
    set({ status: 'authenticated', user, bootstrapped: true });
    return user;
  },

  logout: async () => {
    try {
      await authApi.logoutUser();
    } finally {
      setAccessToken(null);
      set({ status: 'unauthenticated', user: null, bootstrapped: true });
    }
  },

  logoutAll: async () => {
    try {
      await authApi.logoutAllDevices();
    } finally {
      setAccessToken(null);
      set({ status: 'unauthenticated', user: null, bootstrapped: true });
    }
  },

  setUser: (user) => set({ user }),

  clearSession: () => {
    setAccessToken(null);
    set({ status: 'unauthenticated', user: null, bootstrapped: true });
  },
}));

// Automatically clear client auth state when a background silent refresh fails.
onSessionExpired(() => {
  useAuthStore.getState().clearSession();
});
