// Blocking an account: for how long and why. The reason is what the account
// reads when it tries to sign in. A moderator may block for a day, a week or a
// month; a block without an end needs the admin's permission.

import { useState, type SubmitEvent } from 'react';
import { ADMIN_REASON_MAX_LENGTH, type BlockDuration } from '@voice-room/shared/contracts/admin';
import { BLOCK_DURATIONS } from '../accounts.ts';
import { useCan } from '../staff.tsx';
import { Button, Dialog, Segment } from '../ui/index.tsx';
import './AccountDialogs.css';

interface Props {
  open: boolean;
  name: string;
  onClose: () => void;
  /** Resolves to an error text, or null once the block is in place. */
  onConfirm: (input: { duration: BlockDuration; reason: string }) => Promise<string | null>;
}

// The form is the dialog's child, so it starts empty every time the dialog opens.
function BlockForm({ onClose, onConfirm }: Pick<Props, 'onClose' | 'onConfirm'>) {
  const canForever = useCan('accounts.manage');
  const [duration, setDuration] = useState<BlockDuration>('week');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !reason.trim()) return;
    setBusy(true);
    setError((await onConfirm({ duration, reason: reason.trim() })) ?? '');
    setBusy(false);
  }

  return (
    <form className="account-dialog" onSubmit={(event) => void submit(event)}>
      <p className="account-dialog-text">
        Аккаунт сразу выйдет со всех устройств и из войса. При входе он увидит срок и причину.
      </p>
      <div>
        <span className="account-dialog-label">Срок</span>
        <Segment
          options={BLOCK_DURATIONS.filter((option) => canForever || option.value !== 'forever')}
          value={duration}
          onChange={setDuration}
          ariaLabel="Срок блокировки"
        />
      </div>
      <div>
        <label className="account-dialog-label" htmlFor="blockReason">
          Причина
        </label>
        <textarea
          id="blockReason"
          className="account-dialog-input"
          rows={3}
          maxLength={ADMIN_REASON_MAX_LENGTH}
          placeholder="Например: спам в чатах комнат"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {error ? (
        <p className="account-dialog-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="account-dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="danger" type="submit" disabled={busy || !reason.trim()}>
          {busy ? 'Блокируем…' : 'Заблокировать'}
        </Button>
      </div>
    </form>
  );
}

export function AccountBlockDialog({ open, name, onClose, onConfirm }: Props) {
  return (
    <Dialog open={open} title={`Заблокировать ${name}`} onClose={onClose}>
      <BlockForm onClose={onClose} onConfirm={onConfirm} />
    </Dialog>
  );
}
