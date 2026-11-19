import { create } from 'zustand';
import * as usersApi from '@/services/users.api';
import type { PublicUser } from '@/types/api';
import { normalizeApiError } from '@/utils/errors';

interface UsersState {
  directory: PublicUser[];
  nextCursor: string | null;
  directoryLoading: boolean;
  directoryLoadingMore: boolean;
  directoryError: string | null;

  searchResults: PublicUser[];
  searchLoading: boolean;
  searchError: string | null;

  blockedUsers: PublicUser[];
  blockedLoading: boolean;
  blockedIds: Set<string>;

  loadDirectory: () => Promise<void>;
  loadMoreDirectory: () => Promise<void>;
  runSearch: (query: string) => Promise<void>;
  clearSearch: () => void;
  loadBlockedUsers: () => Promise<void>;
  blockUser: (user: PublicUser) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  reset: () => void;
}

export const useUsersStore = create<UsersState>((set, get) => ({
  directory: [],
  nextCursor: null,
  directoryLoading: false,
  directoryLoadingMore: false,
  directoryError: null,

  searchResults: [],
  searchLoading: false,
  searchError: null,

  blockedUsers: [],
  blockedLoading: false,
  blockedIds: new Set<string>(),

  loadDirectory: async () => {
    set({ directoryLoading: true, directoryError: null });
    try {
      const { users, nextCursor } = await usersApi.listUsers({ limit: 30 });
      set({ directory: users, nextCursor, directoryLoading: false });
    } catch (err) {
      set({ directoryError: normalizeApiError(err).message, directoryLoading: false });
    }
  },

  loadMoreDirectory: async () => {
    const { nextCursor, directoryLoadingMore } = get();
    if (!nextCursor || directoryLoadingMore) return;
    set({ directoryLoadingMore: true });
    try {
      const { users, nextCursor: next } = await usersApi.listUsers({ limit: 30, cursor: nextCursor });
      set((s) => ({
        directory: [...s.directory, ...users],
        nextCursor: next,
        directoryLoadingMore: false,
      }));
    } catch {
      set({ directoryLoadingMore: false });
    }
  },

  runSearch: async (query) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      set({ searchResults: [], searchLoading: false, searchError: null });
      return;
    }
    set({ searchLoading: true, searchError: null });
    try {
      const users = await usersApi.searchUsers(trimmed, 20);
      set({ searchResults: users, searchLoading: false });
    } catch (err) {
      set({ searchError: normalizeApiError(err).message, searchLoading: false });
    }
  },

  clearSearch: () => set({ searchResults: [], searchLoading: false, searchError: null }),

  loadBlockedUsers: async () => {
    set({ blockedLoading: true });
    try {
      const list = await usersApi.fetchBlockedUsers();
      set({
        blockedUsers: list,
        blockedIds: new Set(list.map((u) => u.id)),
        blockedLoading: false,
      });
    } catch {
      set({ blockedLoading: false });
    }
  },

  blockUser: async (user) => {
    await usersApi.blockUserById(user.id);
    set((s) => {
      const nextIds = new Set(s.blockedIds);
      nextIds.add(user.id);
      const already = s.blockedUsers.some((u) => u.id === user.id);
      return {
        blockedIds: nextIds,
        blockedUsers: already ? s.blockedUsers : [{ ...user, isOnline: false, lastSeenAt: null }, ...s.blockedUsers],
      };
    });
  },

  unblockUser: async (userId) => {
    await usersApi.unblockUserById(userId);
    set((s) => {
      const nextIds = new Set(s.blockedIds);
      nextIds.delete(userId);
      return {
        blockedIds: nextIds,
        blockedUsers: s.blockedUsers.filter((u) => u.id !== userId),
      };
    });
  },

  reset: () =>
    set({
      directory: [],
      nextCursor: null,
      directoryLoading: false,
      directoryLoadingMore: false,
      directoryError: null,
      searchResults: [],
      searchLoading: false,
      searchError: null,
      blockedUsers: [],
      blockedLoading: false,
      blockedIds: new Set<string>(),
    }),
}));
