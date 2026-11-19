import { useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Quick',
    emojis: ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉', '👏', '💯', '🚀', '✨'],
  },
  {
    label: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😅', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😎', '🤔', '🤨', '😐', '😴', '🤯', '🥳', '😭'],
  },
  {
    label: 'Gestures',
    emojis: ['👋', '🤚', '👌', '✌️', '🤞', '🤝', '🙌', '💪', '👀', '🫡', '🫶', '👎'],
  },
  {
    label: 'Work & Tech',
    emojis: ['💻', '⚡', '🔒', '🛡️', '📦', '🐛', '✅', '❌', '⚠️', '📌', '📎', '📝', '☕', '🎯'],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  compact?: boolean;
  className?: string;
}

export function EmojiPicker({ onSelect, onClose, compact = false, className }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeGroup, setActiveGroup] = useState(0);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  if (compact) {
    return (
      <div
        ref={ref}
        role="menu"
        aria-label="Quick reactions"
        className={cn(
          'flex items-center gap-0.5 rounded-full border border-border-subtle bg-bg-elevated px-2 py-1 shadow-md',
          className,
        )}
      >
        {EMOJI_GROUPS[0]!.emojis.slice(0, 7).map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onSelect(emoji);
              onClose();
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full text-base transition-transform hover:scale-125 hover:bg-bg-hover cursor-pointer"
          >
            {emoji}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji picker"
      className={cn(
        'w-72 rounded-2xl border border-border-subtle bg-bg-elevated p-3 shadow-lg',
        className,
      )}
    >
      <div className="mb-2 flex gap-1 border-b border-border-subtle pb-2">
        {EMOJI_GROUPS.map((g, idx) => (
          <button
            key={g.label}
            type="button"
            onClick={() => setActiveGroup(idx)}
            className={cn(
              'rounded-lg px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
              activeGroup === idx
                ? 'bg-brand-50 text-brand-600 dark:text-brand-200'
                : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {EMOJI_GROUPS[activeGroup]!.emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSelect(emoji)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-transform hover:scale-115 hover:bg-bg-hover cursor-pointer"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
