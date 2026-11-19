import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import type { PublicUser } from '@/types/api';
import { cn } from '@/utils/cn';
import { formatRelativeTime } from '@/utils/format';

interface UserDirectoryItemProps {
  user: PublicUser;
  selected?: boolean;
  isBlocked?: boolean;
  unreadCount?: number;
  onSelect: (user: PublicUser) => void;
}

export function UserDirectoryItem({
  user,
  selected = false,
  isBlocked = false,
  unreadCount = 0,
  onSelect,
}: UserDirectoryItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(user)}
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors cursor-pointer',
        selected
          ? 'bg-bg-active ring-1 ring-brand-500/20'
          : 'hover:bg-bg-hover',
      )}
    >
      <Avatar
        name={user.displayName}
        seed={user.id}
        src={user.avatarUrl}
        size="md"
        isOnline={!isBlocked && user.isOnline}
        showPresence
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-text-primary">{user.displayName}</p>
          {unreadCount > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : isBlocked ? (
            <Badge variant="danger">Blocked</Badge>
          ) : (
            <span className="shrink-0 text-[11px] text-text-muted">
              {user.isOnline ? 'Online' : formatRelativeTime(user.lastSeenAt)}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate font-mono text-xs text-text-muted">@{user.username}</span>
          {user.bio && (
            <>
              <span className="text-text-muted/60">·</span>
              <span className="truncate text-xs text-text-muted">{user.bio}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
