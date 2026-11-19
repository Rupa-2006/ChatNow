import { create } from 'zustand';
import type { PublicUser } from '@/types/api';

export type ToastVariant = 'info' | 'success' | 'error';

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
};

export type SidebarTab = 'chats' | 'people';
export type MobilePane = 'sidebar' | 'chat';

interface UiState {
  rightPanelOpen: boolean;
  sidebarTab: SidebarTab;
  mobilePane: MobilePane;
  selectedUser: PublicUser | null;
  toasts: ToastItem[];

  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setMobilePane: (pane: MobilePane) => void;
  selectUser: (user: PublicUser | null) => void;
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
  resetUi: () => void;
}

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  rightPanelOpen: true,
  sidebarTab: 'chats',
  mobilePane: 'sidebar',
  selectedUser: null,
  toasts: [],

  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setMobilePane: (pane) => set({ mobilePane: pane }),
  selectUser: (user) =>
    set({
      selectedUser: user,
      mobilePane: user ? 'chat' : 'sidebar',
    }),

  addToast: (toast) => {
    const id = `toast-${Date.now()}-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4500);
    return id;
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  resetUi: () =>
    set({
      selectedUser: null,
      mobilePane: 'sidebar',
      sidebarTab: 'chats',
    }),
}));
