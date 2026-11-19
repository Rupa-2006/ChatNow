import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** Called when the user confirms. The dialog shows a spinner until it settles. */
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

/**
 * "Are you sure?" step for actions that cannot be undone (deleting a message,
 * removing someone from a group), so one mis-click cannot cause them.
 */
export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title={title} description={description}>
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={() => void handleConfirm()} loading={busy} autoFocus>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
