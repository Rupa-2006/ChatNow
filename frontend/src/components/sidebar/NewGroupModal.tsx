import { useState, type FormEvent } from 'react';
import { Check, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useChatStore } from '@/store/chatStore';
import { useUiStore } from '@/store/uiStore';
import { useUsersStore } from '@/store/usersStore';
import { cn } from '@/utils/cn';
import { normalizeApiError } from '@/utils/errors';

interface NewGroupModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewGroupModal({ open, onClose }: NewGroupModalProps) {
  const directory = useUsersStore((s) => s.directory);
  const createGroupConversation = useChatStore((s) => s.createGroupConversation);
  const addToast = useUiStore((s) => s.addToast);

  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleClose = () => {
    setName('');
    setSelectedIds([]);
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Enter a group name.');
      return;
    }
    if (selectedIds.length === 0) {
      setError('Select at least one member.');
      return;
    }

    setCreating(true);
    try {
      await createGroupConversation(name.trim(), selectedIds);
      addToast({ title: 'Group created', description: `"${name.trim()}" is ready.`, variant: 'success' });
      handleClose();
    } catch (err) {
      setError(normalizeApiError(err).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create a group"
      description="Start a multi-member group conversation with role-based permissions."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorState compact message={error} />}

        <Input
          label="Group name"
          placeholder="e.g. Architecture Sync"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          leftIcon={<Users className="h-4 w-4" />}
          autoFocus
        />

        <div>
          <p className="mb-2 text-xs font-medium text-text-secondary">
            Select members ({selectedIds.length} selected)
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border-subtle bg-bg-subtle p-2">
            {directory.length === 0 ? (
              <p className="py-4 text-center text-xs text-text-muted">No other users available yet.</p>
            ) : (
              directory.map((person) => {
                const checked = selectedIds.includes(person.id);
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => toggleMember(person.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer',
                      checked ? 'bg-brand-50 ring-1 ring-brand-500/25' : 'hover:bg-bg-hover',
                    )}
                  >
                    <Avatar name={person.displayName} seed={person.id} src={person.avatarUrl} size="xs" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-text-primary">{person.displayName}</p>
                      <p className="truncate font-mono text-[10px] text-text-muted">@{person.username}</p>
                    </div>
                    <span
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-md border text-white transition-colors',
                        checked ? 'border-brand-500 bg-brand-500' : 'border-border-strong bg-bg-surface',
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={creating}>
            Create group
          </Button>
        </div>
      </form>
    </Modal>
  );
}
