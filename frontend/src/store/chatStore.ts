import { create } from 'zustand';
import * as convApi from '@/services/conversations.api';
import * as msgApi from '@/services/messages.api';
import * as notifApi from '@/services/notifications.api';
import { performSilentRefresh } from '@/services/http';
import {
  connectSocket,
  disconnectSocket,
  emitWithAck,
  getSocket,
  showBrowserNotification,
} from '@/services/socket';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import type {
  Attachment,
  Conversation,
  Member,
  MemberRole,
  Message,
  NotificationItem,
  PublicUser,
} from '@/types/api';
import { normalizeApiError } from '@/utils/errors';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

type PresenceInfo = { isOnline: boolean; lastSeenAt: string | null };

interface ChatState {
  connectionState: ConnectionState;
  conversations: Conversation[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  activeConversationId: string | null;

  /** Stored chronologically (oldest -> newest) for rendering. */
  messagesByConv: Record<string, Message[]>;
  nextCursorByConv: Record<string, string | null>;
  messagesLoadingByConv: Record<string, boolean>;
  loadingOlderByConv: Record<string, boolean>;
  highlightedMessageId: string | null;

  /** Map conversationId -> array of currently typing userIds */
  typingByConv: Record<string, string[]>;
  presenceByUser: Record<string, PresenceInfo>;

  notifications: NotificationItem[];
  unreadNotificationCount: number;

  replyToMessage: Message | null;
  editingMessage: Message | null;

  initRealtime: () => void;
  teardownRealtime: () => void;

  loadConversations: () => Promise<void>;
  selectConversation: (conversationId: string | null) => Promise<void>;
  openDirectConversation: (user: PublicUser) => Promise<Conversation>;
  createGroupConversation: (name: string, memberIds: string[]) => Promise<Conversation>;
  loadOlderMessages: (conversationId: string) => Promise<void>;
  jumpToMessage: (conversationId: string, messageId: string) => Promise<void>;

  sendMessage: (
    conversationId: string,
    content: string,
    attachments?: Attachment[],
  ) => Promise<void>;
  retryMessage: (conversationId: string, clientId: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  markActiveConversationRead: () => Promise<void>;

  emitTyping: (conversationId: string, isTyping: boolean) => void;

  renameGroup: (conversationId: string, name: string) => Promise<void>;
  toggleMuteConversation: (conversationId: string, mute: boolean) => Promise<void>;
  addGroupMembers: (conversationId: string, userIds: string[]) => Promise<void>;
  removeGroupMember: (conversationId: string, userId: string) => Promise<void>;
  changeGroupMemberRole: (conversationId: string, userId: string, role: 'ADMIN' | 'MEMBER') => Promise<void>;
  leaveGroup: (conversationId: string) => Promise<void>;
  updateConversationInStore: (conv: Conversation) => void;

  loadNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;

  setReplyToMessage: (msg: Message | null) => void;
  setEditingMessage: (msg: Message | null) => void;
  reset: () => void;
}

const typingExpiryTimers = new Map<string, number>();

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const tA = new Date(a.lastMessageAt ?? a.createdAt).getTime();
    const tB = new Date(b.lastMessageAt ?? b.createdAt).getTime();
    return tB - tA;
  });
}

function upsertMessageChronological(existing: Message[], incoming: Message): Message[] {
  const byIdOrClient = existing.findIndex(
    (m) => m.id === incoming.id || (m.clientId && m.clientId === incoming.clientId),
  );
  if (byIdOrClient >= 0) {
    const copy = [...existing];
    copy[byIdOrClient] = incoming;
    return copy;
  }
  const next = [...existing, incoming];
  next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return next;
}

export function getConversationDisplayName(conv: Conversation, myUserId: string | undefined): string {
  if (conv.type === 'GROUP') return conv.name || 'Untitled group';
  const other = conv.members.find((m) => m.user.id !== myUserId)?.user ?? conv.members[0]?.user;
  return other?.displayName ?? 'Direct chat';
}

export function getDirectPeer(conv: Conversation, myUserId: string | undefined): PublicUser | null {
  if (conv.type !== 'DIRECT') return null;
  return conv.members.find((m) => m.user.id !== myUserId)?.user ?? null;
}

export const useChatStore = create<ChatState>((set, get) => ({
  connectionState: 'disconnected',
  conversations: [],
  conversationsLoading: false,
  conversationsError: null,
  activeConversationId: null,

  messagesByConv: {},
  nextCursorByConv: {},
  messagesLoadingByConv: {},
  loadingOlderByConv: {},
  highlightedMessageId: null,

  typingByConv: {},
  presenceByUser: {},

  notifications: [],
  unreadNotificationCount: 0,

  replyToMessage: null,
  editingMessage: null,

  initRealtime: () => {
    set({ connectionState: 'connecting' });
    const socket = connectSocket();
    socket.removeAllListeners();

    socket.on('connect', () => {
      set({ connectionState: 'connected' });
      // Reconnection catch-up: reload conversations, active thread, presence, and retry failed sends.
      void get().loadConversations().then(() => {
        const convs = get().conversations;
        const userIds = new Set<string>();
        for (const c of convs) {
          for (const m of c.members) userIds.add(m.user.id);
        }
        if (userIds.size > 0) {
          void emitWithAck<Record<string, PresenceInfo>>('presence:subscribe', {
            userIds: Array.from(userIds).slice(0, 200),
          }).then((ack) => {
            if (ack.ok && ack.data) {
              set((s) => ({ presenceByUser: { ...s.presenceByUser, ...ack.data } }));
            }
          });
        }
      });

      const activeId = get().activeConversationId;
      if (activeId) {
        void get().selectConversation(activeId);
      }

      // Resend any failed messages with their original clientId (idempotent on server).
      const allMsgs = get().messagesByConv;
      for (const [convId, msgs] of Object.entries(allMsgs)) {
        for (const m of msgs) {
          if (m.status === 'failed') {
            void get().retryMessage(convId, m.clientId);
          }
        }
      }
    });

    socket.on('disconnect', () => {
      set({ connectionState: 'disconnected' });
    });

    socket.on('connect_error', () => {
      set({ connectionState: 'disconnected' });
    });

    socket.on('session:revoked', async (payload: { reason?: string }) => {
      // An expired access token is not a sign-out: the refresh cookie is usually still
      // valid. Renew it and let Socket.IO reconnect with the new token (its `auth`
      // callback reads the current one). Only end the session if renewal fails.
      if (payload?.reason === 'token_expired') {
        const renewed = await performSilentRefresh();
        if (renewed) {
          set({ connectionState: 'connecting' });
          getSocket()?.connect();
          return;
        }
      }
      disconnectSocket();
      useAuthStore.getState().clearSession();
      useUiStore.getState().addToast({
        title: 'Session ended',
        description:
          payload?.reason === 'password_changed'
            ? 'Your password was changed on another device.'
            : 'Please sign in again.',
        variant: 'info',
      });
    });

    socket.on('message:new', (msg: Message) => {
      const me = useAuthStore.getState().user;
      const isFromMe = me?.id === msg.senderId;
      const isActive = get().activeConversationId === msg.conversationId;
      const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';

      set((s) => {
        const existing = s.messagesByConv[msg.conversationId] ?? [];
        const updatedMsgs = upsertMessageChronological(existing, msg);
        const convExists = s.conversations.some((c) => c.id === msg.conversationId);
        const updatedConvs = convExists
          ? sortConversations(
              s.conversations.map((c) => {
                if (c.id !== msg.conversationId) return c;
                const shouldIncrementUnread = !isFromMe && !(isActive && isVisible);
                return {
                  ...c,
                  lastMessage: msg,
                  lastMessageAt: msg.createdAt,
                  unreadCount: shouldIncrementUnread ? c.unreadCount + 1 : 0,
                };
              }),
            )
          : s.conversations;

        return {
          messagesByConv: { ...s.messagesByConv, [msg.conversationId]: updatedMsgs },
          conversations: updatedConvs,
        };
      });

      if (!isFromMe) {
        // Acknowledge delivery immediately
        socket.emit('message:delivered', { messageIds: [msg.id] });

        if (isActive && isVisible) {
          socket.emit('conversation:read', { conversationId: msg.conversationId, messageId: msg.id });
        } else if (me?.notificationPrefs.browser) {
          const conv = get().conversations.find((c) => c.id === msg.conversationId);
          const title = conv ? getConversationDisplayName(conv, me.id) : 'New message';
          const body = me.notificationPrefs.messagePreview
            ? msg.content || 'Sent an attachment'
            : 'You have a new message';
          showBrowserNotification(title, body);
        }
      }
    });

    socket.on('message:updated', (msg: Message) => {
      set((s) => {
        const list = s.messagesByConv[msg.conversationId];
        return {
          messagesByConv: list
            ? { ...s.messagesByConv, [msg.conversationId]: upsertMessageChronological(list, msg) }
            : s.messagesByConv,
          conversations: s.conversations.map((c) =>
            c.id === msg.conversationId && c.lastMessage?.id === msg.id ? { ...c, lastMessage: msg } : c,
          ),
        };
      });
    });

    socket.on('message:deleted', (payload: { conversationId: string; messageId: string; deletedAt: string }) => {
      set((s) => {
        const list = s.messagesByConv[payload.conversationId];
        const nextList = list?.map((m) =>
          m.id === payload.messageId
            ? { ...m, content: '', deletedAt: payload.deletedAt, attachments: [], reactions: [] }
            : m,
        );
        return {
          messagesByConv: nextList
            ? { ...s.messagesByConv, [payload.conversationId]: nextList }
            : s.messagesByConv,
          conversations: s.conversations.map((c) =>
            c.id === payload.conversationId && c.lastMessage?.id === payload.messageId
              ? {
                  ...c,
                  lastMessage: { ...c.lastMessage, content: '', deletedAt: payload.deletedAt },
                }
              : c,
          ),
        };
      });
    });

    socket.on(
      'message:reaction',
      (payload: { conversationId: string; messageId: string; reactions: Message['reactions'] }) => {
        set((s) => {
          const list = s.messagesByConv[payload.conversationId];
          if (!list) return s;
          return {
            messagesByConv: {
              ...s.messagesByConv,
              [payload.conversationId]: list.map((m) =>
                m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m,
              ),
            },
          };
        });
      },
    );

    socket.on(
      'receipt:update',
      (payload: {
        conversationId: string;
        messageIds: string[];
        userId: string;
        status: 'delivered' | 'read';
      }) => {
        const idSet = new Set(payload.messageIds);
        set((s) => {
          const list = s.messagesByConv[payload.conversationId];
          const upgrade = (cur: Message['status']): Message['status'] => {
            if (payload.status === 'read') return 'read';
            if (cur === 'read') return 'read';
            return 'delivered';
          };

          return {
            messagesByConv: list
              ? {
                  ...s.messagesByConv,
                  [payload.conversationId]: list.map((m) =>
                    idSet.has(m.id) ? { ...m, status: upgrade(m.status) } : m,
                  ),
                }
              : s.messagesByConv,
            conversations: s.conversations.map((c) =>
              c.id === payload.conversationId && c.lastMessage && idSet.has(c.lastMessage.id)
                ? { ...c, lastMessage: { ...c.lastMessage, status: upgrade(c.lastMessage.status) } }
                : c,
            ),
          };
        });
      },
    );

    socket.on('conversation:new', (conv: Conversation) => {
      set((s) => {
        const filtered = s.conversations.filter((c) => c.id !== conv.id);
        return { conversations: sortConversations([conv, ...filtered]) };
      });
    });

    socket.on('conversation:updated', (conv: Conversation) => {
      get().updateConversationInStore(conv);
    });

    socket.on('conversation:removed', ({ conversationId }: { conversationId: string }) => {
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== conversationId),
        activeConversationId: s.activeConversationId === conversationId ? null : s.activeConversationId,
      }));
    });

    socket.on('member:added', ({ conversationId, member }: { conversationId: string; member: Member }) => {
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          if (c.members.some((m) => m.user.id === member.user.id)) return c;
          return { ...c, members: [...c.members, member] };
        }),
      }));
    });

    socket.on('member:removed', ({ conversationId, userId }: { conversationId: string; userId: string }) => {
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === conversationId ? { ...c, members: c.members.filter((m) => m.user.id !== userId) } : c,
        ),
      }));
    });

    socket.on(
      'member:role',
      ({ conversationId, userId, role }: { conversationId: string; userId: string; role: MemberRole }) => {
        const myId = useAuthStore.getState().user?.id;
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            return {
              ...c,
              myRole: userId === myId ? role : c.myRole,
              members: c.members.map((m) => (m.user.id === userId ? { ...m, role } : m)),
            };
          }),
        }));
      },
    );

    socket.on(
      'typing:update',
      ({ conversationId, userId, isTyping }: { conversationId: string; userId: string; isTyping: boolean }) => {
        const timerKey = `${conversationId}:${userId}`;
        const existingTimer = typingExpiryTimers.get(timerKey);
        if (existingTimer) {
          window.clearTimeout(existingTimer);
          typingExpiryTimers.delete(timerKey);
        }

        set((s) => {
          const cur = s.typingByConv[conversationId] ?? [];
          const next = isTyping
            ? cur.includes(userId)
              ? cur
              : [...cur, userId]
            : cur.filter((id) => id !== userId);
          return { typingByConv: { ...s.typingByConv, [conversationId]: next } };
        });

        // Expire stale typing indicator after 6 s if typing:stop was lost
        if (isTyping) {
          const t = window.setTimeout(() => {
            typingExpiryTimers.delete(timerKey);
            set((s) => ({
              typingByConv: {
                ...s.typingByConv,
                [conversationId]: (s.typingByConv[conversationId] ?? []).filter((id) => id !== userId),
              },
            }));
          }, 6_000);
          typingExpiryTimers.set(timerKey, t);
        }
      },
    );

    socket.on(
      'presence:update',
      ({ userId, isOnline, lastSeenAt }: { userId: string; isOnline: boolean; lastSeenAt: string | null }) => {
        set((s) => ({
          presenceByUser: { ...s.presenceByUser, [userId]: { isOnline, lastSeenAt } },
          conversations: s.conversations.map((c) => ({
            ...c,
            members: c.members.map((m) =>
              m.user.id === userId ? { ...m, user: { ...m.user, isOnline, lastSeenAt } } : m,
            ),
          })),
        }));
      },
    );

    socket.on('notification:new', (notif: NotificationItem) => {
      set((s) => ({
        notifications: [notif, ...s.notifications.filter((n) => n.id !== notif.id)],
        unreadNotificationCount: s.unreadNotificationCount + 1,
      }));
    });

    // Reading a conversation (in this tab or another) clears its message notifications
    // on the server; reload so the list and the badge match the server's count.
    socket.on('notification:cleared', () => {
      void get().loadNotifications();
    });
  },

  teardownRealtime: () => {
    for (const timer of typingExpiryTimers.values()) window.clearTimeout(timer);
    typingExpiryTimers.clear();
    disconnectSocket();
    set({ connectionState: 'disconnected' });
  },

  loadConversations: async () => {
    set({ conversationsLoading: true, conversationsError: null });
    try {
      const list = await convApi.listConversations();
      const presencePatch: Record<string, PresenceInfo> = {};
      for (const conv of list) {
        for (const m of conv.members) {
          presencePatch[m.user.id] = { isOnline: m.user.isOnline, lastSeenAt: m.user.lastSeenAt };
        }
      }
      set((s) => ({
        conversations: sortConversations(list),
        conversationsLoading: false,
        presenceByUser: { ...s.presenceByUser, ...presencePatch },
      }));
    } catch (err) {
      set({ conversationsError: normalizeApiError(err).message, conversationsLoading: false });
    }
  },

  selectConversation: async (conversationId) => {
    set({ activeConversationId: conversationId, replyToMessage: null, editingMessage: null });
    if (!conversationId) return;

    useUiStore.getState().setMobilePane('chat');

    set((s) => ({
      messagesLoadingByConv: { ...s.messagesLoadingByConv, [conversationId]: true },
    }));
    try {
      const { messages, nextCursor } = await msgApi.listMessages(conversationId, { limit: 30 });
      // API returns newest-first; store oldest-first for chat scroll view
      const chronological = [...messages].reverse();
      set((s) => ({
        messagesByConv: { ...s.messagesByConv, [conversationId]: chronological },
        nextCursorByConv: { ...s.nextCursorByConv, [conversationId]: nextCursor },
        messagesLoadingByConv: { ...s.messagesLoadingByConv, [conversationId]: false },
      }));
      await get().markActiveConversationRead();
    } catch {
      set((s) => ({
        messagesLoadingByConv: { ...s.messagesLoadingByConv, [conversationId]: false },
      }));
    }
  },

  openDirectConversation: async (user) => {
    const conv = await convApi.createDirectConversation(user.id);
    set((s) => {
      const filtered = s.conversations.filter((c) => c.id !== conv.id);
      return { conversations: sortConversations([conv, ...filtered]) };
    });
    useUiStore.getState().setSidebarTab('chats');
    await get().selectConversation(conv.id);
    return conv;
  },

  createGroupConversation: async (name, memberIds) => {
    const conv = await convApi.createGroupConversation(name, memberIds);
    set((s) => {
      const filtered = s.conversations.filter((c) => c.id !== conv.id);
      return { conversations: sortConversations([conv, ...filtered]) };
    });
    useUiStore.getState().setSidebarTab('chats');
    await get().selectConversation(conv.id);
    return conv;
  },

  loadOlderMessages: async (conversationId) => {
    const cursor = get().nextCursorByConv[conversationId];
    if (!cursor || get().loadingOlderByConv[conversationId]) return;

    set((s) => ({ loadingOlderByConv: { ...s.loadingOlderByConv, [conversationId]: true } }));
    try {
      const { messages, nextCursor } = await msgApi.listMessages(conversationId, { limit: 30, cursor });
      const olderChron = [...messages].reverse();
      set((s) => {
        const current = s.messagesByConv[conversationId] ?? [];
        const existingIds = new Set(current.map((m) => m.id));
        const uniqueOlder = olderChron.filter((m) => !existingIds.has(m.id));
        return {
          messagesByConv: { ...s.messagesByConv, [conversationId]: [...uniqueOlder, ...current] },
          nextCursorByConv: { ...s.nextCursorByConv, [conversationId]: nextCursor },
          loadingOlderByConv: { ...s.loadingOlderByConv, [conversationId]: false },
        };
      });
    } catch {
      set((s) => ({ loadingOlderByConv: { ...s.loadingOlderByConv, [conversationId]: false } }));
    }
  },

  jumpToMessage: async (conversationId, messageId) => {
    const { messages, nextCursor } = await msgApi.listMessages(conversationId, {
      limit: 30,
      around: messageId,
    });
    const chronological = [...messages].reverse();
    set((s) => ({
      activeConversationId: conversationId,
      highlightedMessageId: messageId,
      messagesByConv: { ...s.messagesByConv, [conversationId]: chronological },
      nextCursorByConv: { ...s.nextCursorByConv, [conversationId]: nextCursor },
    }));
    window.setTimeout(() => {
      if (get().highlightedMessageId === messageId) {
        set({ highlightedMessageId: null });
      }
    }, 3_000);
  },

  sendMessage: async (conversationId, content, attachments = []) => {
    const me = useAuthStore.getState().user;
    if (!me) return;

    const trimmed = content.trim();
    if (!trimmed && attachments.length === 0) return;

    const replyTo = get().replyToMessage;
    const clientId = generateUuid();
    const optimistic: Message = {
      id: `optimistic-${clientId}`,
      conversationId,
      senderId: me.id,
      type: attachments.length > 0 && !trimmed ? 'FILE' : 'TEXT',
      content: trimmed,
      clientId,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            senderId: replyTo.senderId,
            content: replyTo.content,
            deleted: Boolean(replyTo.deletedAt),
          }
        : null,
      attachments,
      reactions: [],
      status: 'sending',
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    };

    set((s) => ({
      replyToMessage: null,
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: upsertMessageChronological(s.messagesByConv[conversationId] ?? [], optimistic),
      },
    }));

    const payload = {
      conversationId,
      content: trimmed,
      clientId,
      replyToId: replyTo?.id ?? undefined,
      attachmentIds: attachments.length > 0 ? attachments.map((a) => a.id) : undefined,
    };

    const socket = getSocket();
    if (socket?.connected) {
      const ack = await emitWithAck<Message>('message:send', payload);
      if (ack.ok && ack.data) {
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [conversationId]: upsertMessageChronological(s.messagesByConv[conversationId] ?? [], ack.data),
          },
          conversations: sortConversations(
            s.conversations.map((c) =>
              c.id === conversationId
                ? { ...c, lastMessage: ack.data, lastMessageAt: ack.data.createdAt }
                : c,
            ),
          ),
        }));
        return;
      }
      if (!ack.ok && ack.error.code !== 'TIMEOUT' && ack.error.code !== 'DISCONNECTED') {
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
              m.clientId === clientId ? { ...m, status: 'failed' } : m,
            ),
          },
        }));
        useUiStore.getState().addToast({
          title: 'Message not sent',
          description: ack.error.message,
          variant: 'error',
        });
        return;
      }
    }

    // Fallback to REST when socket is unavailable
    try {
      const sent = await msgApi.sendMessageRest(conversationId, {
        content: trimmed,
        clientId,
        replyToId: replyTo?.id,
        attachmentIds: payload.attachmentIds,
      });
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: upsertMessageChronological(s.messagesByConv[conversationId] ?? [], sent),
        },
        conversations: sortConversations(
          s.conversations.map((c) =>
            c.id === conversationId ? { ...c, lastMessage: sent, lastMessageAt: sent.createdAt } : c,
          ),
        ),
      }));
    } catch (err) {
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
            m.clientId === clientId ? { ...m, status: 'failed' } : m,
          ),
        },
      }));
      useUiStore.getState().addToast({
        title: 'Failed to send',
        description: normalizeApiError(err).message,
        variant: 'error',
      });
    }
  },

  retryMessage: async (conversationId, clientId) => {
    const failed = (get().messagesByConv[conversationId] ?? []).find((m) => m.clientId === clientId);
    if (!failed) return;

    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
          m.clientId === clientId ? { ...m, status: 'sending' } : m,
        ),
      },
    }));

    const payload = {
      conversationId,
      content: failed.content,
      clientId: failed.clientId,
      replyToId: failed.replyTo?.id,
      attachmentIds: failed.attachments.length > 0 ? failed.attachments.map((a) => a.id) : undefined,
    };

    const ack = await emitWithAck<Message>('message:send', payload);
    if (ack.ok && ack.data) {
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: upsertMessageChronological(s.messagesByConv[conversationId] ?? [], ack.data),
        },
      }));
    } else {
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
            m.clientId === clientId ? { ...m, status: 'failed' } : m,
          ),
        },
      }));
    }
  },

  editMessage: async (messageId, content) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const socket = getSocket();
    if (socket?.connected) {
      const ack = await emitWithAck<Message>('message:edit', { messageId, content: trimmed });
      if (ack.ok && ack.data) {
        set((s) => ({
          editingMessage: null,
          messagesByConv: {
            ...s.messagesByConv,
            [ack.data.conversationId]: upsertMessageChronological(
              s.messagesByConv[ack.data.conversationId] ?? [],
              ack.data,
            ),
          },
        }));
        return;
      }
      throw new Error(!ack.ok ? ack.error.message : 'Failed to edit message');
    }
    const updated = await msgApi.editMessageRest(messageId, trimmed);
    set((s) => ({
      editingMessage: null,
      messagesByConv: {
        ...s.messagesByConv,
        [updated.conversationId]: upsertMessageChronological(
          s.messagesByConv[updated.conversationId] ?? [],
          updated,
        ),
      },
    }));
  },

  deleteMessage: async (messageId) => {
    const socket = getSocket();
    if (socket?.connected) {
      const ack = await emitWithAck('message:delete', { messageId });
      if (!ack.ok) throw new Error(ack.error.message);
      return;
    }
    await msgApi.deleteMessageRest(messageId);
  },

  toggleReaction: async (messageId, emoji) => {
    const me = useAuthStore.getState().user;
    if (!me) return;
    const activeId = get().activeConversationId;
    const msg = activeId ? (get().messagesByConv[activeId] ?? []).find((m) => m.id === messageId) : undefined;
    const alreadyReacted = Boolean(msg?.reactions.find((r) => r.emoji === emoji)?.userIds.includes(me.id));

    const socket = getSocket();
    if (socket?.connected) {
      const ack = await emitWithAck<Message>('message:react', {
        messageId,
        emoji,
        remove: alreadyReacted,
      });
      if (!ack.ok) {
        useUiStore.getState().addToast({ title: 'Reaction failed', description: ack.error.message, variant: 'error' });
      }
      return;
    }

    if (alreadyReacted) {
      await msgApi.removeReactionRest(messageId, emoji);
    } else {
      await msgApi.addReactionRest(messageId, emoji);
    }
  },

  markActiveConversationRead: async () => {
    const convId = get().activeConversationId;
    if (!convId) return;
    const msgs = get().messagesByConv[convId] ?? [];
    const lastServerMsg = [...msgs].reverse().find((m) => !m.id.startsWith('optimistic-'));
    if (!lastServerMsg) return;

    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c)),
    }));

    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('conversation:read', { conversationId: convId, messageId: lastServerMsg.id });
    } else {
      await convApi.markConversationRead(convId, lastServerMsg.id).catch(() => {});
    }
  },

  emitTyping: (conversationId, isTyping) => {
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit(isTyping ? 'typing:start' : 'typing:stop', { conversationId });
  },

  renameGroup: async (conversationId, name) => {
    const updated = await convApi.updateConversation(conversationId, { name });
    get().updateConversationInStore(updated);
  },

  toggleMuteConversation: async (conversationId, mute) => {
    const mutedUntil = mute ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null;
    const updated = await convApi.updateConversation(conversationId, { mutedUntil });
    get().updateConversationInStore(updated);
  },

  addGroupMembers: async (conversationId, userIds) => {
    const updated = await convApi.addConversationMembers(conversationId, userIds);
    get().updateConversationInStore(updated);
  },

  removeGroupMember: async (conversationId, userId) => {
    await convApi.removeConversationMember(conversationId, userId);
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, members: c.members.filter((m) => m.user.id !== userId) } : c,
      ),
    }));
  },

  changeGroupMemberRole: async (conversationId, userId, role) => {
    await convApi.updateConversationMemberRole(conversationId, userId, role);
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, members: c.members.map((m) => (m.user.id === userId ? { ...m, role } : m)) }
          : c,
      ),
    }));
  },

  leaveGroup: async (conversationId) => {
    await convApi.leaveConversation(conversationId);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== conversationId),
      activeConversationId: s.activeConversationId === conversationId ? null : s.activeConversationId,
    }));
  },

  updateConversationInStore: (conv) => {
    set((s) => ({
      conversations: sortConversations(s.conversations.map((c) => (c.id === conv.id ? conv : c))),
    }));
  },

  loadNotifications: async () => {
    try {
      const { notifications, unreadCount } = await notifApi.listNotifications({ limit: 30 });
      set({ notifications, unreadNotificationCount: unreadCount });
    } catch {
      // Non-critical background load
    }
  },

  markNotificationRead: async (id) => {
    const updated = await notifApi.markNotificationRead(id);
    set((s) => {
      const wasUnread = s.notifications.find((n) => n.id === id)?.readAt === null;
      return {
        notifications: s.notifications.map((n) => (n.id === id ? updated : n)),
        unreadNotificationCount: wasUnread ? Math.max(0, s.unreadNotificationCount - 1) : s.unreadNotificationCount,
      };
    });
  },

  markAllNotificationsRead: async () => {
    await notifApi.markAllNotificationsRead();
    const now = new Date().toISOString();
    set((s) => ({
      notifications: s.notifications.map((n) => (n.readAt ? n : { ...n, readAt: now })),
      unreadNotificationCount: 0,
    }));
  },

  setReplyToMessage: (msg) => set({ replyToMessage: msg, editingMessage: null }),
  setEditingMessage: (msg) => set({ editingMessage: msg, replyToMessage: null }),

  reset: () => {
    get().teardownRealtime();
    set({
      conversations: [],
      conversationsLoading: false,
      conversationsError: null,
      activeConversationId: null,
      messagesByConv: {},
      nextCursorByConv: {},
      messagesLoadingByConv: {},
      loadingOlderByConv: {},
      highlightedMessageId: null,
      typingByConv: {},
      presenceByUser: {},
      notifications: [],
      unreadNotificationCount: 0,
      replyToMessage: null,
      editingMessage: null,
    });
  },
}));
