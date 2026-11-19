import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BellOff,
  Check,
  CheckCheck,
  MessageSquarePlus,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SidebarListSkeleton } from '@/components/ui/Skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { searchAllMessages } from '@/services/messages.api';
import { useAuthStore } from '@/store/authStore';
import {
  getConversationDisplayName,
  getDirectPeer,
  useChatStore,
} from '@/store/chatStore';
import { useUiStore } from '@/store/uiStore';
import { useUsersStore } from '@/store/usersStore';
import type { Conversation, GlobalMessageHit, PublicUser } from '@/types/api';
import { cn } from '@/utils/cn';
import { normalizeApiError } from '@/utils/errors';
import { formatRelativeTime } from '@/utils/format';
import { NewGroupModal } from './NewGroupModal';
import { NotificationsPopover } from './NotificationsPopover';
import { UserDirectoryItem } from './UserDirectoryItem';

function ConversationListItem({
  conv,
  myUserId,
  active,
  typingCount,
  onSelect,
}: {
  conv: Conversation;
  myUserId: string;
  active: boolean;
  typingCount: number;
  onSelect: () => void;
}) {
  const title = getConversationDisplayName(conv, myUserId);
  const peer = getDirectPeer(conv, myUserId);
  const last = conv.lastMessage;
  const isMuted = Boolean(conv.mutedUntil && new Date(conv.mutedUntil).getTime() > Date.now());

  let preview = 'No messages yet';
  if (typingCount > 0) {
    preview = 'Typing…';
  } else if (last) {
    if (last.deletedAt) preview = 'Message deleted';
    else if (last.content) preview = last.content;
    else if (last.attachments.length > 0) preview = `📎 ${last.attachments[0]!.originalName}`;
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors cursor-pointer',
        active ? 'bg-bg-active ring-1 ring-brand-500/20' : 'hover:bg-bg-hover',
      )}
    >
      <Avatar
        name={title}
        seed={peer?.id ?? conv.id}
        src={peer ? peer.avatarUrl : conv.avatarUrl}
        size="md"
        isOnline={Boolean(peer?.isOnline)}
        showPresence={conv.type === 'DIRECT'}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-text-primary">{title}</p>
            {isMuted && <BellOff className="h-3 w-3 shrink-0 text-text-muted" />}
          </div>
          <span className="shrink-0 text-[11px] text-text-muted">
            {formatRelativeTime(conv.lastMessageAt ?? conv.createdAt)}
          </span>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={cn(
              'flex min-w-0 items-center gap-1 truncate text-xs',
              typingCount > 0 ? 'font-medium text-brand-500' : 'text-text-muted',
            )}
          >
            {last && last.senderId === myUserId && !typingCount && (
              <span className="shrink-0">
                {last.status === 'read' ? (
                  <CheckCheck className="h-3.5 w-3.5 text-status-read" />
                ) : last.status === 'delivered' ? (
                  <CheckCheck className="h-3.5 w-3.5 opacity-70" />
                ) : (
                  <Check className="h-3.5 w-3.5 opacity-70" />
                )}
              </span>
            )}
            <span className="truncate">{preview}</span>
          </p>

          {conv.unreadCount > 0 && (
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">
              {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function LeftSidebar() {
  const user = useAuthStore((s) => s.user);
  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const addToast = useUiStore((s) => s.addToast);

  const conversations = useChatStore((s) => s.conversations);
  const conversationsLoading = useChatStore((s) => s.conversationsLoading);
  const conversationsError = useChatStore((s) => s.conversationsError);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const typingByConv = useChatStore((s) => s.typingByConv);
  const connectionState = useChatStore((s) => s.connectionState);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const openDirectConversation = useChatStore((s) => s.openDirectConversation);
  const jumpToMessage = useChatStore((s) => s.jumpToMessage);

  const directory = useUsersStore((s) => s.directory);
  const nextCursor = useUsersStore((s) => s.nextCursor);
  const directoryLoading = useUsersStore((s) => s.directoryLoading);
  const directoryLoadingMore = useUsersStore((s) => s.directoryLoadingMore);
  const directoryError = useUsersStore((s) => s.directoryError);
  const searchResults = useUsersStore((s) => s.searchResults);
  const searchLoading = useUsersStore((s) => s.searchLoading);
  const searchError = useUsersStore((s) => s.searchError);
  const blockedIds = useUsersStore((s) => s.blockedIds);

  const loadDirectory = useUsersStore((s) => s.loadDirectory);
  const loadMoreDirectory = useUsersStore((s) => s.loadMoreDirectory);
  const runSearch = useUsersStore((s) => s.runSearch);
  const clearSearch = useUsersStore((s) => s.clearSearch);
  const loadBlockedUsers = useUsersStore((s) => s.loadBlockedUsers);

  const [query, setQuery] = useState('');
  const [messageHits, setMessageHits] = useState<GlobalMessageHit[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 250);
  const searchRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcuts({
    onFocusSearch: () => searchRef.current?.focus(),
  });

  useEffect(() => {
    void loadDirectory();
    void loadBlockedUsers();
  }, [loadDirectory, loadBlockedUsers]);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed.length >= 2) {
      void runSearch(trimmed);
      void searchAllMessages(trimmed, { limit: 10 })
        .then((res) => setMessageHits(res.messages))
        .catch(() => setMessageHits([]));
    } else {
      clearSearch();
      setMessageHits([]);
    }
  }, [debouncedQuery, runSearch, clearSearch]);

  const handleOpenDirect = async (person: PublicUser) => {
    try {
      await openDirectConversation(person);
      setQuery('');
      clearSearch();
      setMessageHits([]);
    } catch (err) {
      addToast({ title: 'Could not open chat', description: normalizeApiError(err).message, variant: 'error' });
    }
  };

  const isSearching = query.trim().length >= 2;
  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <aside
      aria-label="Conversations and people"
      className="flex h-full w-full flex-col border-r border-border-subtle bg-bg-surface md:w-80 lg:w-[336px] shrink-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3.5">
        <BrandLogo size="sm" />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setGroupModalOpen(true)}
            title="New group chat"
            aria-label="Create group conversation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          <NotificationsPopover />
          <Link
            to="/settings"
            title="Settings"
            aria-label="Open settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Signed-in user bar */}
      {user && (
        <Link
          to="/profile"
          className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-subtle px-3 py-2.5 hover:border-border-strong transition-colors"
        >
          <Avatar
            name={user.displayName}
            seed={user.id}
            src={user.avatarUrl}
            size="sm"
            isOnline={connectionState === 'connected'}
            showPresence
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary">{user.displayName}</p>
            <p className="truncate font-mono text-[11px] text-text-muted">@{user.username}</p>
          </div>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium',
              connectionState === 'connected'
                ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
            )}
          >
            {connectionState === 'connected' ? 'Live' : 'Connecting'}
          </span>
        </Link>
      )}

      {/* Search bar */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people or messages…"
            aria-label="Search people or messages"
            className="h-9 w-full rounded-xl border border-border-subtle bg-bg-input pl-9 pr-14 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:bg-bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/15 transition-colors"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                clearSearch();
                setMessageHits([]);
              }}
              aria-label="Clear search"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-0.5 text-text-muted hover:text-text-primary cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-md border border-border-subtle bg-bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline-block">
              Ctrl K
            </kbd>
          )}
        </div>
      </div>

      {/* Tabs */}
      {!isSearching && (
        <div className="px-3 pb-2">
          <div
            role="tablist"
            aria-label="Sidebar view"
            className="grid grid-cols-2 rounded-xl bg-bg-subtle p-1 ring-1 ring-border-subtle"
          >
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === 'chats'}
              onClick={() => setSidebarTab('chats')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer',
                sidebarTab === 'chats'
                  ? 'bg-bg-surface text-text-primary shadow-xs'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              <span>Chats</span>
              {totalUnread > 0 && (
                <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold text-white">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === 'people'}
              onClick={() => setSidebarTab('people')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer',
                sidebarTab === 'people'
                  ? 'bg-bg-surface text-text-primary shadow-xs'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              <span>People</span>
              {directory.length > 0 && (
                <span className="rounded-full bg-brand-50 px-1.5 text-[10px] font-semibold text-brand-600 dark:text-brand-200">
                  {directory.length}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* List content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {isSearching ? (
          <div className="space-y-4">
            <div>
              <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                People
              </p>
              {searchLoading ? (
                <SidebarListSkeleton count={2} />
              ) : searchError ? (
                <div className="px-2 py-2">
                  <ErrorState compact message={searchError} onRetry={() => void runSearch(query)} />
                </div>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-2 text-xs text-text-muted">No matching people.</p>
              ) : (
                <div className="space-y-0.5">
                  {searchResults.map((person) => (
                    <UserDirectoryItem
                      key={person.id}
                      user={person}
                      isBlocked={blockedIds.has(person.id)}
                      onSelect={(p) => void handleOpenDirect(p)}
                    />
                  ))}
                </div>
              )}
            </div>

            {messageHits.length > 0 && (
              <div>
                <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Messages
                </p>
                <div className="space-y-1">
                  {messageHits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => {
                        void jumpToMessage(hit.conversationId, hit.id);
                        setQuery('');
                        setMessageHits([]);
                      }}
                      className="w-full rounded-xl border border-border-subtle bg-bg-subtle px-3 py-2 text-left hover:bg-bg-hover transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-semibold text-brand-600 dark:text-brand-200">
                          {hit.conversation.name ?? 'Direct chat'}
                        </span>
                        <span className="text-[10px] text-text-muted">{formatRelativeTime(hit.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-text-primary">{hit.content}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : sidebarTab === 'chats' ? (
          conversationsLoading && conversations.length === 0 ? (
            <SidebarListSkeleton count={5} />
          ) : conversationsError ? (
            <ErrorState
              title="Could not load conversations"
              message={conversationsError}
              onRetry={() => void loadConversations()}
            />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={<MessageSquarePlus className="h-5 w-5" />}
              title="No conversations yet"
              description="Start a direct chat from the People tab or create a group conversation."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Users className="h-3.5 w-3.5" />}
                    onClick={() => setSidebarTab('people')}
                  >
                    Browse people
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setGroupModalOpen(true)}>
                    New group
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="space-y-0.5">
              {conversations.map((conv) => (
                <ConversationListItem
                  key={conv.id}
                  conv={conv}
                  myUserId={user?.id ?? ''}
                  active={conv.id === activeConversationId}
                  typingCount={(typingByConv[conv.id] ?? []).filter((id) => id !== user?.id).length}
                  onSelect={() => void selectConversation(conv.id)}
                />
              ))}
            </div>
          )
        ) : directoryLoading ? (
          <SidebarListSkeleton count={5} />
        ) : directoryError ? (
          <ErrorState
            title="Could not load directory"
            message={directoryError}
            onRetry={() => void loadDirectory()}
          />
        ) : directory.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="You are the first one here"
            description="Register a second account in another browser window or run npm run seed to populate demo users."
          />
        ) : (
          <div className="space-y-0.5">
            {directory.map((person) => (
              <UserDirectoryItem
                key={person.id}
                user={person}
                isBlocked={blockedIds.has(person.id)}
                onSelect={(p) => void handleOpenDirect(p)}
              />
            ))}
            {nextCursor && (
              <div className="px-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={directoryLoadingMore}
                  onClick={() => void loadMoreDirectory()}
                  className="w-full"
                >
                  Load more people
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <NewGroupModal open={groupModalOpen} onClose={() => setGroupModalOpen(false)} />
    </aside>
  );
}
