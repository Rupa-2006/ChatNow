import { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Pencil,
  Reply,
  RotateCcw,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import type { Message } from '@/types/api';
import { cn } from '@/utils/cn';
import { formatTime } from '@/utils/format';
import { AttachmentItem } from './AttachmentItem';
import { EmojiPicker } from './EmojiPicker';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  myUserId: string;
  senderName?: string;
  showSenderName?: boolean;
  canModerateDelete?: boolean;
  highlighted?: boolean;
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onRetry?: (clientId: string) => void;
}

function StatusIcon({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return <Clock className="h-3.5 w-3.5 opacity-70" aria-label="Sending" />;
    case 'sent':
      return <Check className="h-3.5 w-3.5 opacity-80" aria-label="Sent" />;
    case 'delivered':
      return <CheckCheck className="h-3.5 w-3.5 opacity-85" aria-label="Delivered" />;
    case 'read':
      return <CheckCheck className="h-3.5 w-3.5 text-cyan-300" aria-label="Read" />;
    case 'failed':
      return <AlertCircle className="h-3.5 w-3.5 text-rose-300" aria-label="Failed to send" />;
  }
}

export function MessageBubble({
  message,
  isOwn,
  myUserId,
  senderName,
  showSenderName = false,
  canModerateDelete = false,
  highlighted = false,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onRetry,
}: MessageBubbleProps) {
  const [showReactPicker, setShowReactPicker] = useState(false);

  const isDeleted = Boolean(message.deletedAt);
  const isOptimistic = message.id.startsWith('optimistic-');
  const canEdit =
    isOwn &&
    !isDeleted &&
    !isOptimistic &&
    Date.now() - new Date(message.createdAt).getTime() <= EDIT_WINDOW_MS;
  const canDelete = !isDeleted && !isOptimistic && (isOwn || canModerateDelete);

  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        'group relative flex flex-col transition-colors rounded-xl px-1 py-0.5',
        isOwn ? 'items-end' : 'items-start',
        highlighted && 'bg-brand-500/15 ring-1 ring-brand-500/35',
      )}
    >
      {showSenderName && !isOwn && senderName && (
        <span className="mb-1 ml-1 text-[11px] font-medium text-text-muted">{senderName}</span>
      )}

      <div className={cn('relative flex max-w-[85%] items-end gap-1.5 sm:max-w-[72%]', isOwn && 'flex-row-reverse')}>
        <div
          className={cn(
            'relative min-w-[84px] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-xs',
            isOwn
              ? 'rounded-tr-sm bg-gradient-to-br from-[var(--bubble-out-from)] to-[var(--bubble-out-to)] text-white'
              : 'rounded-tl-sm border border-[var(--bubble-in-border)] bg-[var(--bubble-in-bg)] text-text-primary',
          )}
        >
          {message.replyTo && !isDeleted && (
            <div
              className={cn(
                'mb-2 rounded-lg border-l-2 px-2.5 py-1.5 text-xs',
                isOwn
                  ? 'border-white/60 bg-white/12 text-white/90'
                  : 'border-brand-500 bg-bg-subtle text-text-secondary',
              )}
            >
              <p className="truncate italic">
                {message.replyTo.deleted ? 'Original message deleted' : message.replyTo.content || 'Attachment'}
              </p>
            </div>
          )}

          {!isDeleted && message.attachments.length > 0 && (
            <div className="mb-2 space-y-2">
              {message.attachments.map((att) => (
                <AttachmentItem key={att.id} attachment={att} isOwn={isOwn} />
              ))}
            </div>
          )}

          {(isDeleted || message.content) && (
            <p className={cn('whitespace-pre-wrap break-words', isDeleted && 'italic opacity-70')}>
              {isDeleted ? 'This message was deleted' : message.content}
            </p>
          )}

          <div
            className={cn(
              'mt-1 flex items-center justify-end gap-1.5 text-[10px]',
              isOwn ? 'text-indigo-100/85' : 'text-text-muted',
            )}
          >
            {message.editedAt && !isDeleted && <span>edited</span>}
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
            {isOwn && <StatusIcon status={message.status} />}
          </div>
        </div>

        {/* Hover Actions */}
        {!isDeleted && !isOptimistic && (
          <div
            className={cn(
              'relative flex items-center gap-0.5 rounded-xl border border-border-subtle bg-bg-elevated p-0.5 shadow-xs opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
            )}
          >
            {onReact && (
              <button
                type="button"
                onClick={() => setShowReactPicker((s) => !s)}
                title="React"
                aria-label="Add reaction"
                className="flex h-6 w-6 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer"
              >
                <SmilePlus className="h-3.5 w-3.5" />
              </button>
            )}
            {onReply && (
              <button
                type="button"
                onClick={() => onReply(message)}
                title="Reply"
                aria-label="Reply to message"
                className="flex h-6 w-6 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer"
              >
                <Reply className="h-3.5 w-3.5" />
              </button>
            )}
            {canEdit && onEdit && (
              <button
                type="button"
                onClick={() => onEdit(message)}
                title="Edit (within 15 min)"
                aria-label="Edit message"
                className="flex h-6 w-6 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {canDelete && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(message)}
                title="Delete"
                aria-label="Delete message"
                className="flex h-6 w-6 items-center justify-center rounded-lg text-text-muted hover:bg-rose-500/10 hover:text-status-danger cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}

            {showReactPicker && onReact && (
              <div className={cn('absolute bottom-8 z-30', isOwn ? 'right-0' : 'left-0')}>
                <EmojiPicker
                  compact
                  onSelect={(emoji) => onReact(message.id, emoji)}
                  onClose={() => setShowReactPicker(false)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Retry control on failed optimistic message */}
      {message.status === 'failed' && onRetry && (
        <button
          type="button"
          onClick={() => onRetry(message.clientId)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-status-danger hover:underline cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" /> Failed to send · Retry
        </button>
      )}

      {/* Reaction pills */}
      {message.reactions.length > 0 && !isDeleted && (
        <div className="mt-1 flex flex-wrap gap-1">
          {message.reactions.map((r) => {
            const mine = r.userIds.includes(myUserId);
            return (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact?.(message.id, r.emoji)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-xs transition-colors cursor-pointer',
                  mine
                    ? 'border-brand-500/40 bg-brand-50 text-brand-700 dark:text-brand-200'
                    : 'border-border-subtle bg-bg-surface text-text-primary hover:bg-bg-hover',
                )}
              >
                <span>{r.emoji}</span>
                <span className="font-mono text-[10px]">{r.userIds.length}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
