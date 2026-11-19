import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Ban,
  Bell,
  BellOff,
  Camera,
  Crown,
  Image as ImageIcon,
  LogOut,
  Pencil,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AttachmentItem } from '@/components/chat/AttachmentItem';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useDebounce } from '@/hooks/useDebounce';
import {
  listConversationAttachments,
  uploadConversationAvatar,
} from '@/services/conversations.api';
import { searchConversationMessages } from '@/services/messages.api';
import { useAuthStore } from '@/store/authStore';
import {
  getConversationDisplayName,
  getDirectPeer,
  useChatStore,
} from '@/store/chatStore';
import { useUiStore } from '@/store/uiStore';
import { useUsersStore } from '@/store/usersStore';
import type { Attachment, Message } from '@/types/api';
import { cn } from '@/utils/cn';
import { normalizeApiError } from '@/utils/errors';
import { formatRelativeTime } from '@/utils/format';

export function RightSidebar() {
  const me = useAuthStore((s) => s.user);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useUiStore((s) => s.setRightPanelOpen);
  const addToast = useUiStore((s) => s.addToast);

  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const jumpToMessage = useChatStore((s) => s.jumpToMessage);
  const renameGroup = useChatStore((s) => s.renameGroup);
  const toggleMuteConversation = useChatStore((s) => s.toggleMuteConversation);
  const addGroupMembers = useChatStore((s) => s.addGroupMembers);
  const removeGroupMember = useChatStore((s) => s.removeGroupMember);
  const changeGroupMemberRole = useChatStore((s) => s.changeGroupMemberRole);
  const leaveGroup = useChatStore((s) => s.leaveGroup);
  const updateConversationInStore = useChatStore((s) => s.updateConversationInStore);

  const directory = useUsersStore((s) => s.directory);
  const blockedIds = useUsersStore((s) => s.blockedIds);
  const blockUser = useUsersStore((s) => s.blockUser);
  const unblockUser = useUsersStore((s) => s.unblockUser);

  const [inChatQuery, setInChatQuery] = useState('');
  const debouncedQuery = useDebounce(inChatQuery, 250);
  const [searchHits, setSearchHits] = useState<Message[]>([]);
  const [sharedMedia, setSharedMedia] = useState<Attachment[]>([]);
  const [blockBusy, setBlockBusy] = useState(false);

  // Group management states
  const [editingName, setEditingName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId) ?? null;

  useEffect(() => {
    setInChatQuery('');
    setSearchHits([]);
    setEditingName(false);
    setShowAddMember(false);
    if (!activeConv) {
      setSharedMedia([]);
      return;
    }
    setGroupNameDraft(activeConv.name ?? '');
    void listConversationAttachments(activeConv.id, { limit: 12 })
      .then((res) => setSharedMedia(res.attachments))
      .catch(() => setSharedMedia([]));
  }, [activeConv?.id]);

  useEffect(() => {
    if (!activeConv || debouncedQuery.trim().length < 1) {
      setSearchHits([]);
      return;
    }
    void searchConversationMessages(activeConv.id, debouncedQuery.trim(), { limit: 15 })
      .then((res) => setSearchHits(res.messages))
      .catch(() => setSearchHits([]));
  }, [activeConv?.id, debouncedQuery]);

  if (!rightPanelOpen) return null;

  const peer = activeConv && me ? getDirectPeer(activeConv, me.id) : null;
  const isBlocked = peer ? blockedIds.has(peer.id) : false;
  const isMuted = Boolean(
    activeConv?.mutedUntil && new Date(activeConv.mutedUntil).getTime() > Date.now(),
  );
  const canManageGroup =
    activeConv?.type === 'GROUP' && (activeConv.myRole === 'OWNER' || activeConv.myRole === 'ADMIN');
  const isOwner = activeConv?.type === 'GROUP' && activeConv.myRole === 'OWNER';

  const handleToggleBlock = async () => {
    if (!peer || blockBusy) return;
    setBlockBusy(true);
    try {
      if (isBlocked) {
        await unblockUser(peer.id);
        addToast({ title: 'User unblocked', variant: 'success' });
      } else {
        await blockUser(peer);
        addToast({ title: 'User blocked', variant: 'info' });
      }
    } catch (err) {
      addToast({ title: 'Action failed', description: normalizeApiError(err).message, variant: 'error' });
    } finally {
      setBlockBusy(false);
    }
  };

  const handleRenameSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeConv || !groupNameDraft.trim()) return;
    try {
      await renameGroup(activeConv.id, groupNameDraft.trim());
      setEditingName(false);
      addToast({ title: 'Group renamed', variant: 'success' });
    } catch (err) {
      addToast({ title: 'Rename failed', description: normalizeApiError(err).message, variant: 'error' });
    }
  };

  const handleGroupAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeConv) return;
    try {
      const updated = await uploadConversationAvatar(activeConv.id, file);
      updateConversationInStore(updated);
      addToast({ title: 'Group image updated', variant: 'success' });
    } catch (err) {
      addToast({ title: 'Upload failed', description: normalizeApiError(err).message, variant: 'error' });
    }
  };

  const existingMemberIds = new Set(activeConv?.members.map((m) => m.user.id) ?? []);
  const addableUsers = directory.filter((u) => !existingMemberIds.has(u.id));

  return (
    <>
      <div
        aria-hidden="true"
        onClick={() => setRightPanelOpen(false)}
        className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-[1px] xl:hidden"
      />

      <aside
        aria-label="Conversation details"
        className={cn(
          'fixed top-0 right-0 z-40 flex h-full w-80 flex-col border-l border-border-subtle bg-bg-surface shadow-lg xl:static xl:z-auto xl:shadow-none shrink-0',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle px-4">
          <h2 className="font-display text-sm font-semibold text-text-primary">Details</h2>
          <button
            type="button"
            onClick={() => setRightPanelOpen(false)}
            aria-label="Close details panel"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
          {activeConv && me ? (
            <>
              {/* Summary card */}
              <div className="flex flex-col items-center rounded-2xl border border-border-subtle bg-bg-subtle p-5 text-center">
                <div className="relative">
                  <Avatar
                    name={getConversationDisplayName(activeConv, me.id)}
                    seed={peer?.id ?? activeConv.id}
                    src={peer ? peer.avatarUrl : activeConv.avatarUrl}
                    size="xl"
                    isOnline={Boolean(peer && !isBlocked && peer.isOnline)}
                    showPresence={activeConv.type === 'DIRECT'}
                  />
                  {canManageGroup && (
                    <>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => void handleGroupAvatarUpload(e)}
                      />
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        title="Change group image"
                        aria-label="Change group image"
                        className="absolute -right-1 -bottom-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-text-secondary shadow-xs hover:text-brand-500 cursor-pointer"
                      >
                        <Camera className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {editingName ? (
                  <form onSubmit={(e) => void handleRenameSubmit(e)} className="mt-3 flex w-full gap-1.5">
                    <input
                      type="text"
                      value={groupNameDraft}
                      onChange={(e) => setGroupNameDraft(e.target.value)}
                      maxLength={80}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-surface px-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                      autoFocus
                    />
                    <Button type="submit" size="xs">
                      Save
                    </Button>
                  </form>
                ) : (
                  <div className="mt-3 flex items-center gap-1.5">
                    <h3 className="font-display text-base font-semibold text-text-primary">
                      {getConversationDisplayName(activeConv, me.id)}
                    </h3>
                    {canManageGroup && (
                      <button
                        type="button"
                        onClick={() => setEditingName(true)}
                        aria-label="Rename group"
                        className="rounded-md p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {peer && <p className="font-mono text-xs text-text-muted">@{peer.username}</p>}

                <div className="mt-2">
                  {activeConv.type === 'GROUP' ? (
                    <Badge variant="brand">{activeConv.members.length} members</Badge>
                  ) : isBlocked ? (
                    <Badge variant="danger">Blocked</Badge>
                  ) : peer?.isOnline ? (
                    <Badge variant="success">Online now</Badge>
                  ) : (
                    <Badge variant="neutral">Last seen {formatRelativeTime(peer?.lastSeenAt)}</Badge>
                  )}
                </div>

                {peer?.bio && (
                  <p className="mt-3 text-xs leading-relaxed text-text-secondary">{peer.bio}</p>
                )}

                <div className="mt-4 flex w-full flex-col gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void toggleMuteConversation(activeConv.id, !isMuted)}
                    leftIcon={isMuted ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                    className="w-full"
                  >
                    {isMuted ? 'Unmute notifications' : 'Mute notifications'}
                  </Button>

                  {peer && (
                    <Button
                      variant={isBlocked ? 'secondary' : 'outline'}
                      size="sm"
                      loading={blockBusy}
                      onClick={() => void handleToggleBlock()}
                      leftIcon={isBlocked ? <ShieldCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                      className={cn(
                        'w-full',
                        !isBlocked && 'text-status-danger border-rose-500/30 hover:bg-rose-500/8',
                      )}
                    >
                      {isBlocked ? 'Unblock user' : 'Block user'}
                    </Button>
                  )}

                  {activeConv.type === 'GROUP' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await leaveGroup(activeConv.id);
                        addToast({ title: 'Left group', variant: 'info' });
                      }}
                      leftIcon={<LogOut className="h-3.5 w-3.5" />}
                      className="w-full text-status-danger border-rose-500/30 hover:bg-rose-500/8"
                    >
                      Leave group
                    </Button>
                  )}
                </div>
              </div>

              {/* Search in conversation */}
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  <Search className="h-3.5 w-3.5" /> Search in chat
                </h3>
                <input
                  type="search"
                  value={inChatQuery}
                  onChange={(e) => setInChatQuery(e.target.value)}
                  placeholder="Search messages…"
                  aria-label="Search messages in conversation"
                  className="h-9 w-full rounded-xl border border-border-subtle bg-bg-input px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:bg-bg-surface focus:outline-none"
                />
                {searchHits.length > 0 && (
                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {searchHits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => void jumpToMessage(activeConv.id, hit.id)}
                        className="w-full rounded-lg border border-border-subtle bg-bg-subtle px-2.5 py-1.5 text-left text-xs hover:bg-bg-hover cursor-pointer"
                      >
                        <p className="truncate text-text-primary">{hit.content}</p>
                        <p className="text-[10px] text-text-muted">{formatRelativeTime(hit.createdAt)}</p>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* Group Members */}
              {activeConv.type === 'GROUP' && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                      <Users className="h-3.5 w-3.5" /> Members ({activeConv.members.length})
                    </h3>
                    {canManageGroup && (
                      <button
                        type="button"
                        onClick={() => setShowAddMember((s) => !s)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-500 hover:underline cursor-pointer"
                      >
                        <UserPlus className="h-3.5 w-3.5" /> Add
                      </button>
                    )}
                  </div>

                  {showAddMember && canManageGroup && (
                    <div className="space-y-1 rounded-xl border border-border-subtle bg-bg-subtle p-2">
                      {addableUsers.length === 0 ? (
                        <p className="py-1 text-center text-[11px] text-text-muted">
                          Everyone in directory is already a member.
                        </p>
                      ) : (
                        addableUsers.slice(0, 6).map((u) => (
                          <div key={u.id} className="flex items-center justify-between gap-2 px-1.5 py-1">
                            <span className="truncate text-xs text-text-primary">{u.displayName}</span>
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={async () => {
                                await addGroupMembers(activeConv.id, [u.id]);
                                addToast({ title: `Added ${u.displayName}`, variant: 'success' });
                              }}
                            >
                              Add
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {activeConv.members.map((m) => {
                      const canRemove =
                        m.user.id !== me.id &&
                        ((isOwner && m.role !== 'OWNER') ||
                          (activeConv.myRole === 'ADMIN' && m.role === 'MEMBER'));
                      return (
                        <div
                          key={m.user.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-border-subtle bg-bg-subtle px-2.5 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar
                              name={m.user.displayName}
                              seed={m.user.id}
                              src={m.user.avatarUrl}
                              size="xs"
                              isOnline={m.user.isOnline}
                              showPresence
                            />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-text-primary">
                                {m.user.displayName} {m.user.id === me.id && '(You)'}
                              </p>
                              <p className="text-[10px] text-text-muted">{m.role}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            {m.role === 'OWNER' && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                            {isOwner && m.user.id !== me.id && (
                              <button
                                type="button"
                                title={m.role === 'ADMIN' ? 'Demote to member' : 'Promote to admin'}
                                aria-label={m.role === 'ADMIN' ? 'Demote to member' : 'Promote to admin'}
                                onClick={() =>
                                  void changeGroupMemberRole(
                                    activeConv.id,
                                    m.user.id,
                                    m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN',
                                  )
                                }
                                className="rounded-md p-1 text-text-muted hover:bg-bg-hover hover:text-brand-500 cursor-pointer"
                              >
                                <Shield className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canRemove && (
                              <button
                                type="button"
                                title="Remove member"
                                aria-label={`Remove ${m.user.displayName}`}
                                onClick={() => void removeGroupMember(activeConv.id, m.user.id)}
                                className="rounded-md p-1 text-text-muted hover:bg-rose-500/10 hover:text-status-danger cursor-pointer"
                              >
                                <UserMinus className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Shared Media */}
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  <ImageIcon className="h-3.5 w-3.5" /> Shared media ({sharedMedia.length})
                </h3>
                {sharedMedia.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border-subtle bg-bg-subtle/60 p-4 text-center text-xs text-text-muted">
                    Photos and files shared in this conversation will appear here.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sharedMedia.map((att) => (
                      <AttachmentItem key={att.id} attachment={att} compact />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="rounded-2xl border border-border-subtle bg-bg-subtle p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                No conversation selected
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                Open a direct or group conversation to inspect members, shared media, or search
                message history.
              </p>
            </div>
          )}

          {/* Security Notice */}
          <div className="rounded-xl border border-border-subtle bg-bg-subtle/70 p-3.5">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="h-4 w-4 shrink-0 text-brand-500 mt-0.5" aria-hidden="true" />
              <div className="text-[11px] leading-relaxed text-text-muted">
                <p className="font-semibold text-text-primary">Transport security</p>
                <p className="mt-0.5">
                  Connections use HTTPS/WSS in transit. ChatNow does not claim end-to-end
                  encryption.
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
