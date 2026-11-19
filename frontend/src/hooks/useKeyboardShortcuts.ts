import { useEffect } from 'react';

interface ShortcutMap {
  onFocusSearch?: () => void;
  onEscape?: () => void;
}

export function useKeyboardShortcuts({ onFocusSearch, onEscape }: ShortcutMap) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (onFocusSearch) {
          event.preventDefault();
          onFocusSearch();
        }
        return;
      }

      if (event.key === 'Escape' && onEscape) {
        onEscape();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onFocusSearch, onEscape]);
}
