import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ThemeProvider } from '@/contexts/ThemeContext';
import * as authApi from '@/services/auth.api';
import * as convApi from '@/services/conversations.api';
import * as msgApi from '@/services/messages.api';
import * as notifApi from '@/services/notifications.api';
import * as socketModule from '@/services/socket';
import * as usersApi from '@/services/users.api';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useUiStore } from '@/store/uiStore';
import { useUsersStore } from '@/store/usersStore';
import type { Conversation, Me, Message, PublicUser } from '@/types/api';

const ALICE: Me = {
  id: '11111111-1111-1111-1111-111111111111',
  username: 'alice',
  displayName: 'Alice Johnson',
  email: 'alice@example.com',
  avatarUrl: null,
  bio: 'Security & systems',
  isOnline: true,
  lastSeenAt: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  notificationPrefs: { browser: true, sound: true, messagePreview: true },
};

const BOB: PublicUser = {
  id: '22222222-2222-2222-2222-222222222222',
  username: 'bob',
  displayName: 'Bob Carter',
  avatarUrl: null,
  bio: 'Backend engineer',
  isOnline: true,
  lastSeenAt: null,
};

const DIRECT_CONV: Conversation = {
  id: '33333333-3333-3333-3333-333333333333',
  type: 'DIRECT',
  name: null,
  avatarUrl: null,
  members: [
    { user: ALICE, role: 'MEMBER', joinedAt: '2026-11-18T00:00:00.000Z' },
    { user: BOB, role: 'MEMBER', joinedAt: '2026-11-18T00:00:00.000Z' },
  ],
  lastMessage: null,
  unreadCount: 0,
  mutedUntil: null,
  myRole: 'MEMBER',
  createdAt: '2026-11-18T00:00:00.000Z',
  lastMessageAt: null,
};

const SENT_MSG: Message = {
  id: '44444444-4444-4444-4444-444444444444',
  conversationId: DIRECT_CONV.id,
  senderId: ALICE.id,
  type: 'TEXT',
  content: 'Hey Bob, real-time messaging is live!',
  clientId: '55555555-5555-5555-5555-555555555555',
  replyTo: null,
  attachments: [],
  reactions: [],
  status: 'sent',
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-11-18T00:05:00.000Z',
};

function renderApp(path = '/chat') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('AppShell, Phase 4 Messaging, Profile & Settings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    Element.prototype.scrollIntoView = vi.fn();

    vi.spyOn(socketModule, 'connectSocket').mockReturnValue({
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
      connected: false,
    } as unknown as ReturnType<typeof socketModule.connectSocket>);
    vi.spyOn(socketModule, 'disconnectSocket').mockImplementation(() => {});

    useAuthStore.setState({ status: 'authenticated', user: ALICE, bootstrapped: true });
    useChatStore.getState().reset();
    useUiStore.getState().resetUi();
    useUiStore.setState({ rightPanelOpen: true });
    useUsersStore.getState().reset();

    vi.spyOn(convApi, 'listConversations').mockResolvedValue([]);
    vi.spyOn(convApi, 'createDirectConversation').mockResolvedValue(DIRECT_CONV);
    vi.spyOn(convApi, 'listConversationAttachments').mockResolvedValue({ attachments: [], nextCursor: null });
    vi.spyOn(convApi, 'markConversationRead').mockResolvedValue();
    vi.spyOn(msgApi, 'listMessages').mockResolvedValue({ messages: [], nextCursor: null });
    vi.spyOn(msgApi, 'sendMessageRest').mockImplementation(async (_convId, payload) => ({
      ...SENT_MSG,
      content: payload.content,
      clientId: payload.clientId,
    }));
    vi.spyOn(notifApi, 'listNotifications').mockResolvedValue({ notifications: [], nextCursor: null, unreadCount: 0 });
    vi.spyOn(usersApi, 'listUsers').mockResolvedValue({ users: [BOB], nextCursor: null });
    vi.spyOn(usersApi, 'fetchBlockedUsers').mockResolvedValue([]);
    vi.spyOn(authApi, 'fetchSessions').mockResolvedValue([
      {
        id: 'sess-1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',
        ipAddress: '127.0.0.1',
        createdAt: '2026-11-18T00:00:00.000Z',
        lastActiveAt: '2026-11-18T01:00:00.000Z',
        current: true,
      },
    ]);
  });

  it('opens a direct conversation from People directory and sends a message', async () => {
    const user = userEvent.setup();
    renderApp('/chat');

    await user.click(screen.getByRole('tab', { name: /people/i }));
    const bobRow = await screen.findByRole('button', { name: /bob carter/i });
    await user.click(bobRow);

    expect(await screen.findByRole('heading', { level: 1, name: 'Bob Carter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /block user/i })).toBeInTheDocument();

    const composer = screen.getByLabelText(/message bob carter/i);
    await user.type(composer, 'Hey Bob, real-time messaging is live!');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    // Reconciled to 1 message bubble in the thread + 1 preview snippet in the sidebar
    const matches = await screen.findAllByText('Hey Bob, real-time messaging is live!');
    expect(matches).toHaveLength(2);
    expect(screen.getByLabelText('Sent')).toBeInTheDocument();
  });

  it('switches themes and renders active sessions in Settings', async () => {
    const user = userEvent.setup();
    renderApp('/settings');

    expect(await screen.findByText(/chrome on windows/i)).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /dark/i }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('chatnow_theme')).toBe('dark');
  });
});
