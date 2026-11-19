import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ThemeProvider } from '@/contexts/ThemeContext';
import * as convApi from '@/services/conversations.api';
import * as notifApi from '@/services/notifications.api';
import * as socketModule from '@/services/socket';
import * as usersApi from '@/services/users.api';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import type { Me } from '@/types/api';

const ALICE: Me = {
  id: '11111111-1111-1111-1111-111111111111',
  username: 'alice',
  displayName: 'Alice Johnson',
  email: 'alice@example.com',
  avatarUrl: null,
  bio: null,
  isOnline: true,
  lastSeenAt: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  notificationPrefs: { browser: true, sound: true, messagePreview: true },
};

function renderRoutes(initialPath: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('Route protection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(socketModule, 'connectSocket').mockReturnValue({
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
      connected: false,
    } as unknown as ReturnType<typeof socketModule.connectSocket>);
    vi.spyOn(socketModule, 'disconnectSocket').mockImplementation(() => {});
    useChatStore.getState().reset();
    vi.spyOn(convApi, 'listConversations').mockResolvedValue([]);
    vi.spyOn(notifApi, 'listNotifications').mockResolvedValue({ notifications: [], nextCursor: null, unreadCount: 0 });
    vi.spyOn(usersApi, 'listUsers').mockResolvedValue({ users: [], nextCursor: null });
    vi.spyOn(usersApi, 'fetchBlockedUsers').mockResolvedValue([]);
  });

  it('redirects unauthenticated users from /chat to /login', async () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null, bootstrapped: true });

    renderRoutes('/chat');

    expect(await screen.findByRole('heading', { name: /sign in to chatnow/i })).toBeInTheDocument();
  });

  it('redirects authenticated users away from /login to /chat', async () => {
    useAuthStore.setState({ status: 'authenticated', user: ALICE, bootstrapped: true });

    renderRoutes('/login');

    expect(await screen.findByText(/welcome, alice johnson/i)).toBeInTheDocument();
  });

  it('shows restoring session loader while bootstrapping', () => {
    useAuthStore.setState({ status: 'bootstrapping', user: null, bootstrapped: true });

    renderRoutes('/chat');

    expect(screen.getByRole('status', { name: /restoring your session/i })).toBeInTheDocument();
  });
});
