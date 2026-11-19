import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useChatStore } from '@/store/chatStore';
import type { NotificationItem } from '@/types/api';
import { cn } from '@/utils/cn';
import { formatRelativeTime } from '@/utils/format';

function describeNotification(n: NotificationItem): { title: string; subtitle: string } {
  const data = n.data;
  switch (n.type) {
    case 'NEW_MESSAGE':
      return {
        title: String(data.senderName ?? 'New message'),
        subtitle:
          data.conversationType === 'GROUP' && data.conversationName
            ? `Sent a message in ${String(data.conversationName)}`
            : 'Sent you a direct message',
      };
    case 'ADDED_TO_GROUP':
      return {
        title: `Added to ${String(data.groupName ?? 'a group')}`,
        subtitle: 'You can now join the conversation',
      };
    case 'REMOVED_FROM_GROUP':
      return {
        title: `Removed from ${String(data.groupName ?? 'a group')}`,
        subtitle: 'Your membership was ended',
      };
    case 'ROLE_CHANGED':
      return {
        title: `Role updated in ${String(data.groupName ?? 'group')}`,
        subtitle: `You are now ${String(data.role ?? 'MEMBER')}`,
      };
    default:
      return { title: 'Notification', subtitle: 'Activity on ChatNow' };
  }
}

export function NotificationsPopover() {
  const notifications = useChatStore((s) => s.notifications);
  const unreadCount = useChatStore((s) => s.unreadNotificationCount);
  const markNotificationRead = useChatStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useChatStore((s) => s.markAllNotificationsRead);
  const selectConversation = useChatStore((s) => s.selectConversation);

  const [open, setOpen] = useState(false);
  const [browserPerm, setBrowserPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const requestBrowserPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setBrowserPerm(perm);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications list"
          className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-border-subtle bg-bg-elevated shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <h3 className="font-display text-sm font-semibold text-text-primary">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllNotificationsRead()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-500 hover:underline cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          {browserPerm === 'default' && (
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-brand-50/60 px-3.5 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <BellRing className="h-3.5 w-3.5 text-brand-500 shrink-0" /> Enable desktop alerts?
              </span>
              <Button size="xs" onClick={() => void requestBrowserPermission()}>
                Allow
              </Button>
            </div>
          )}

          <div className="max-h-80 overflow-y-auto p-1.5">
            {notifications.length === 0 ? (
              <p className="py-8 text-center text-xs text-text-muted">You&apos;re all caught up.</p>
            ) : (
              notifications.map((n) => {
                const { title, subtitle } = describeNotification(n);
                const unread = n.readAt === null;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      if (unread) void markNotificationRead(n.id);
                      if (n.conversationId) void selectConversation(n.conversationId);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer',
                      unread ? 'bg-brand-50/50 hover:bg-brand-50' : 'hover:bg-bg-hover',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        unread ? 'bg-brand-500' : 'bg-transparent',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-text-primary">{title}</p>
                      <p className="truncate text-[11px] text-text-muted">{subtitle}</p>
                      <p className="mt-0.5 text-[10px] text-text-muted">{formatRelativeTime(n.createdAt)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
