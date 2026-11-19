import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, MessageSquare, ShieldCheck, UserCog, Users, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuthStore } from '@/store/authStore';
import {
  getConversationDisplayName,
  getDirectPeer,
  useChatStore,
} from '@/store/chatStore';
import { useUiStore } from '@/store/uiStore';
import { useUsersStore } from '@/store/usersStore';
import { normalizeApiError } from '@/utils/errors';
import { ChatHeader } from './ChatHeader';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';

export function ChatWorkspace() {
  const me = useAuthStore((s) => s.user);
  const connectionState = useChatStore((s) => s.connectionState);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const messagesByConv = useChatStore((s) => s.messagesByConv);
  const nextCursorByConv = useChatStore((s) => s.nextCursorByConv);
  const messagesLoadingByConv = useChatStore((s) => s.messagesLoadingByConv);
  const loadingOlderByConv = useChatStore((s) => s.loadingOlderByConv);
  const highlightedMessageId = useChatStore((s) => s.highlightedMessageId);
  const typingByConv = useChatStore((s) => s.typingByConv);

  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  const setReplyToMessage = useChatStore((s) => s.setReplyToMessage);
  const setEditingMessage = useChatStore((s) => s.setEditingMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const toggleReaction = useChatStore((s) => s.toggleReaction);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const markActiveConversationRead = useChatStore((s) => s.markActiveConversationRead);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const setMobilePane = useUiStore((s) => s.setMobilePane);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const addToast = useUiStore((s) => s.addToast);
  const blockedIds = useUsersStore((s) => s.blockedIds);

  const bottomRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId) ?? null;
  const messages = activeConv ? (messagesByConv[activeConv.id] ?? []) : [];
  const nextCursor = activeConv ? (nextCursorByConv[activeConv.id] ?? null) : null;
  const loadingMessages = activeConv ? Boolean(messagesLoadingByConv[activeConv.id]) : false;
  const loadingOlder = activeConv ? Boolean(loadingOlderByConv[activeConv.id]) : false;

  // Scroll to bottom on new messages (unless jumping to a search highlight)
  useEffect(() => {
    if (highlightedMessageId) {
      const el = document.getElementById(`msg-${highlightedMessageId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversationId, messages.length, highlightedMessageId]);

  // Mark conversation read when user returns focus to this tab
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        void markActiveConversationRead();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [markActiveConversationRead]);

  if (!me || !activeConv) {
    return (
      <section
        aria-label="Welcome to ChatNow"
        className="chat-grid-bg flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center"
      >
        <div className="max-w-md rounded-3xl border border-border-subtle bg-bg-surface/95 p-8 shadow-md backdrop-blur-xs">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white shadow-sm">
            <MessageSquare className="h-7 w-7" />
          </div>

          <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">
            Welcome{me ? `, ${me.displayName}` : ' to ChatNow'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            Select a conversation from the left sidebar or start a new direct or group chat from the
            People tab.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Button
              size="sm"
              leftIcon={<Users className="h-4 w-4" />}
              onClick={() => {
                setSidebarTab('people');
                setMobilePane('sidebar');
              }}
            >
              Browse People
            </Button>
            <Link to="/profile">
              <Button variant="secondary" size="sm" leftIcon={<UserCog className="h-4 w-4" />}>
                Edit Profile
              </Button>
            </Link>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 border-t border-border-subtle pt-4 text-xs text-text-muted">
            <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>Press</span>
            <kbd className="rounded border border-border-subtle bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-primary">
              Ctrl + K
            </kbd>
            <span>anytime to search users</span>
          </div>
        </div>
      </section>
    );
  }

  const peer = getDirectPeer(activeConv, me.id);
  const isBlocked = Boolean(peer && blockedIds.has(peer.id));
  const title = getConversationDisplayName(activeConv, me.id);
  const canModerateDelete =
    activeConv.type === 'GROUP' && (activeConv.myRole === 'OWNER' || activeConv.myRole === 'ADMIN');

  const memberNameById = new Map(activeConv.members.map((m) => [m.user.id, m.user.displayName]));
  const typingIds = (typingByConv[activeConv.id] ?? []).filter((id) => id !== me.id);
  const typingText =
    typingIds.length === 0
      ? null
      : typingIds.length === 1
        ? `${memberNameById.get(typingIds[0]!) ?? 'Someone'} is typing…`
        : `${typingIds.length} people are typing…`;

  const handleDelete = async (msgId: string) => {
    try {
      await deleteMessage(msgId);
    } catch (err) {
      addToast({ title: 'Could not delete message', description: normalizeApiError(err).message, variant: 'error' });
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <section aria-label={`Conversation: ${title}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader
        conversation={activeConv}
        myUserId={me.id}
        isBlocked={isBlocked}
        typingText={typingText}
        rightPanelOpen={rightPanelOpen}
        onToggleRightPanel={toggleRightPanel}
        onMobileBack={() => setMobilePane('sidebar')}
      />

      {connectionState === 'disconnected' && (
        <div className="flex items-center justify-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          <WifiOff className="h-3.5 w-3.5" />
          <span>Reconnecting to live messaging server…</span>
        </div>
      )}

      {/* Message History */}
      <div className="chat-grid-bg flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-6">
        {nextCursor && (
          <div className="mb-4 flex justify-center">
            <Button
              variant="secondary"
              size="xs"
              loading={loadingOlder}
              onClick={() => void loadOlderMessages(activeConv.id)}
            >
              Load older messages
            </Button>
          </div>
        )}

        {loadingMessages && messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<MessageSquare className="h-5 w-5" />}
              title={`Start chatting with ${title}`}
              description="Messages are delivered instantly over Socket.IO and persisted in PostgreSQL."
            />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {messages.map((msg, idx) => {
              const prev = messages[idx - 1];
              const showSender =
                activeConv.type === 'GROUP' && msg.senderId !== me.id && prev?.senderId !== msg.senderId;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={msg.senderId === me.id}
                  myUserId={me.id}
                  senderName={memberNameById.get(msg.senderId)}
                  showSenderName={showSender}
                  canModerateDelete={canModerateDelete}
                  highlighted={highlightedMessageId === msg.id}
                  onReply={setReplyToMessage}
                  onEdit={setEditingMessage}
                  onDelete={(m) => setPendingDeleteId(m.id)}
                  onReact={(id, emoji) => void toggleReaction(id, emoji)}
                  onRetry={(cid) => void retryMessage(activeConv.id, cid)}
                />
              );
            })}

            {typingText && (
              <div className="mt-1 flex items-center gap-2 pl-2 text-xs text-text-muted">
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500" />
                </span>
                <span>{typingText}</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <MessageComposer
        conversationId={activeConv.id}
        recipientName={title}
        disabled={isBlocked}
        disabledReason={isBlocked ? 'Unblock this user in the details panel to send messages.' : undefined}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this message?"
        description="It will be removed for everyone in this conversation. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => (pendingDeleteId ? handleDelete(pendingDeleteId) : undefined)}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  );
}
