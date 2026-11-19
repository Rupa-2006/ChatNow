import { ArrowLeft, BellOff, PanelRightClose, PanelRightOpen, Search, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { getConversationDisplayName, getDirectPeer } from '@/store/chatStore';
import type { Conversation } from '@/types/api';
import { formatRelativeTime } from '@/utils/format';

interface ChatHeaderProps {
  conversation: Conversation;
  myUserId: string;
  isBlocked: boolean;
  typingText: string | null;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
  onMobileBack: () => void;
}

export function ChatHeader({
  conversation,
  myUserId,
  isBlocked,
  typingText,
  rightPanelOpen,
  onToggleRightPanel,
  onMobileBack,
}: ChatHeaderProps) {
  const title = getConversationDisplayName(conversation, myUserId);
  const peer = getDirectPeer(conversation, myUserId);
  const isMuted = Boolean(conversation.mutedUntil && new Date(conversation.mutedUntil).getTime() > Date.now());
  const onlineCount = conversation.members.filter((m) => m.user.isOnline).length;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle bg-bg-surface px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMobileBack}
          aria-label="Back to conversations"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-text-secondary hover:bg-bg-hover md:hidden cursor-pointer"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>

        <Avatar
          name={title}
          seed={peer?.id ?? conversation.id}
          src={peer ? peer.avatarUrl : conversation.avatarUrl}
          size="md"
          isOnline={Boolean(peer && !isBlocked && peer.isOnline)}
          showPresence={conversation.type === 'DIRECT'}
        />

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-sm font-semibold text-text-primary sm:text-base">
              {title}
            </h1>
            {conversation.type === 'GROUP' && (
              <Badge variant="brand">
                <Users className="h-3 w-3" /> {conversation.members.length}
              </Badge>
            )}
            {isBlocked && <Badge variant="danger">Blocked</Badge>}
            {isMuted && <BellOff className="h-3.5 w-3.5 text-text-muted shrink-0" aria-label="Muted" />}
          </div>
          <p className="truncate text-xs text-text-muted">
            {typingText ? (
              <span className="font-medium text-brand-500">{typingText}</span>
            ) : conversation.type === 'GROUP' ? (
              `${conversation.members.length} members · ${onlineCount} online`
            ) : isBlocked ? (
              'Messaging disabled while blocked'
            ) : peer?.isOnline ? (
              'Active now'
            ) : (
              `Last seen ${formatRelativeTime(peer?.lastSeenAt)}`
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleRightPanel}
          title="Search in conversation"
          aria-label="Search in conversation"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleRightPanel}
          title={rightPanelOpen ? 'Hide details panel' : 'Show details panel'}
          aria-label={rightPanelOpen ? 'Hide details panel' : 'Show details panel'}
          aria-pressed={rightPanelOpen}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
        >
          {rightPanelOpen ? (
            <PanelRightClose className="h-4.5 w-4.5" />
          ) : (
            <PanelRightOpen className="h-4.5 w-4.5" />
          )}
        </button>
      </div>
    </header>
  );
}
