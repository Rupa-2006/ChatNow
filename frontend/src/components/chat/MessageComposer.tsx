import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { FileText, Loader2, Paperclip, Pencil, Reply, SendHorizontal, Smile, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { uploadAttachment } from '@/services/attachments.api';
import { useChatStore } from '@/store/chatStore';
import { useUiStore } from '@/store/uiStore';
import type { Attachment } from '@/types/api';
import { normalizeApiError } from '@/utils/errors';
import { EmojiPicker } from './EmojiPicker';

interface MessageComposerProps {
  conversationId: string;
  recipientName: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function MessageComposer({
  conversationId,
  recipientName,
  disabled = false,
  disabledReason,
}: MessageComposerProps) {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const editMessage = useChatStore((s) => s.editMessage);
  const emitTyping = useChatStore((s) => s.emitTyping);
  const replyToMessage = useChatStore((s) => s.replyToMessage);
  const editingMessage = useChatStore((s) => s.editingMessage);
  const setReplyToMessage = useChatStore((s) => s.setReplyToMessage);
  const setEditingMessage = useChatStore((s) => s.setEditingMessage);
  const addToast = useUiStore((s) => s.addToast);

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingSentRef = useRef<number>(0);
  const idleStopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (editingMessage) {
      setDraft(editingMessage.content);
      inputRef.current?.focus();
    }
  }, [editingMessage]);

  useEffect(() => {
    if (replyToMessage) {
      inputRef.current?.focus();
    }
  }, [replyToMessage]);

  useEffect(() => {
    // Reset draft and stop typing when switching conversations
    setDraft('');
    setAttachments([]);
    setShowEmoji(false);
    return () => {
      if (idleStopTimerRef.current) window.clearTimeout(idleStopTimerRef.current);
      emitTyping(conversationId, false);
    };
  }, [conversationId, emitTyping]);

  const stopTypingNow = () => {
    if (idleStopTimerRef.current) {
      window.clearTimeout(idleStopTimerRef.current);
      idleStopTimerRef.current = null;
    }
    lastTypingSentRef.current = 0;
    emitTyping(conversationId, false);
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (disabled || editingMessage) return;

    if (value.trim().length === 0) {
      stopTypingNow();
      return;
    }

    const now = Date.now();
    // Throttle typing:start to at most once every 3 s
    if (now - lastTypingSentRef.current >= 3_000) {
      lastTypingSentRef.current = now;
      emitTyping(conversationId, true);
    }

    if (idleStopTimerRef.current) window.clearTimeout(idleStopTimerRef.current);
    idleStopTimerRef.current = window.setTimeout(() => {
      stopTypingNow();
    }, 5_000);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (attachments.length >= 10) {
      addToast({ title: 'Limit reached', description: 'Up to 10 attachments per message.', variant: 'error' });
      return;
    }

    setUploading(true);
    try {
      const uploaded = await uploadAttachment(file);
      setAttachments((prev) => [...prev, uploaded]);
    } catch (err) {
      addToast({ title: 'Upload rejected', description: normalizeApiError(err).message, variant: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (disabled || uploading) return;

    const trimmed = draft.trim();
    if (editingMessage) {
      if (!trimmed) return;
      try {
        await editMessage(editingMessage.id, trimmed);
        setDraft('');
      } catch (err) {
        addToast({ title: 'Could not edit message', description: normalizeApiError(err).message, variant: 'error' });
      }
      return;
    }

    if (!trimmed && attachments.length === 0) return;
    stopTypingNow();
    const toSendAttachments = attachments;
    setDraft('');
    setAttachments([]);
    setShowEmoji(false);
    await sendMessage(conversationId, trimmed, toSendAttachments);
  };

  return (
    <div className="relative shrink-0 border-t border-border-subtle bg-bg-surface px-3 py-3 sm:px-5">
      {disabledReason && (
        <p className="mb-2 text-center text-[11px] text-text-muted">{disabledReason}</p>
      )}

      {/* Reply or Edit banner */}
      {(replyToMessage || editingMessage) && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-brand-500/25 bg-brand-50/70 px-3 py-2 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            {editingMessage ? (
              <Pencil className="h-3.5 w-3.5 shrink-0 text-brand-500" />
            ) : (
              <Reply className="h-3.5 w-3.5 shrink-0 text-brand-500" />
            )}
            <div className="min-w-0">
              <p className="font-semibold text-brand-700 dark:text-brand-200">
                {editingMessage ? 'Editing message' : 'Replying to message'}
              </p>
              <p className="truncate text-text-secondary">
                {(editingMessage ?? replyToMessage)?.content || 'Attachment'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setReplyToMessage(null);
              setEditingMessage(null);
              if (editingMessage) setDraft('');
            }}
            aria-label="Cancel"
            className="rounded-lg p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Pending attachment chips */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-subtle px-2.5 py-1 text-xs text-text-primary"
            >
              <FileText className="h-3.5 w-3.5 text-brand-500 shrink-0" />
              <span className="max-w-36 truncate">{att.originalName}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                aria-label={`Remove ${att.originalName}`}
                className="text-text-muted hover:text-status-danger cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {showEmoji && (
        <div className="absolute bottom-16 left-4 z-30">
          <EmojiPicker
            onSelect={(emoji) => {
              handleDraftChange(draft + emoji);
              inputRef.current?.focus();
            }}
            onClose={() => setShowEmoji(false)}
          />
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => void handleFileChange(e)}
          aria-hidden="true"
        />

        <div className="flex items-center gap-1 pb-0.5">
          {!editingMessage && (
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => fileRef.current?.click()}
              title="Attach file (max 10 MB)"
              aria-label="Attach file"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {uploading ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Paperclip className="h-4.5 w-4.5" />}
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowEmoji((s) => !s)}
            title="Insert emoji"
            aria-label="Insert emoji"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Smile className="h-4.5 w-4.5" />
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          disabled={disabled}
          maxLength={4000}
          placeholder={
            editingMessage
              ? 'Update your message…'
              : disabled
                ? 'Messaging disabled…'
                : `Message ${recipientName}…`
          }
          aria-label={`Message ${recipientName}`}
          className="h-10 min-w-0 flex-1 rounded-xl border border-border-subtle bg-bg-input px-3.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:bg-bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:opacity-60"
        />

        <Button
          type="submit"
          size="icon"
          disabled={disabled || uploading || (draft.trim().length === 0 && attachments.length === 0)}
          aria-label={editingMessage ? 'Save edit' : 'Send message'}
          className="h-10 w-10 shrink-0"
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
