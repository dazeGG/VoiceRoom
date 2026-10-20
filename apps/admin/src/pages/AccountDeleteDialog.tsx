// Deleting an account: the login typed again so the wrong one is not
// deleted by a slip, and a reason. The account is blocked at once and gone
// after the grace period; until then the deletion can be called off.

import { useState, type FormEvent } from 'react';
import { ADMIN_REASON_MAX_LENGTH } from '@voice-room/shared/contracts/admin';
import { Button, Dialog } from '../ui/index.tsx';
import './AccountDialogs.css';

interface Props {
  open: boolean;
  login: string;
  onClose: () => void;
  /** Resolves to an error text, or null once the deletion is scheduled. */
  onConfirm: (input: { login: string; reason: string }) => Promise<string | null>;
}

// The form is the dialog's child, so it starts empty every time the dialog opens.
function DeleteForm({ login, onClose, onConfirm }: Omit<Props, 'open'>) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = typed.trim().toLowerCase() === login;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !matches || !reason.trim()) return;
    setBusy(true);
    setError((await onConfirm({ login: typed.trim(), reason: reason.trim() })) ?? '');
    setBusy(false);
  }

  return (
    <form className="account-dialog" onSubmit={(event) => void submit(event)}>
      <p className="account-dialog-text">
        Аккаунт сразу заблокируется навсегда и скроется под именем «Удалённый аккаунт». Через 7 дней удаление станет
        окончательным: комнаты перейдут участникам, сообщения останутся без автора. До этого его можно отменить здесь
        же.
      </p>
      <div>
        <label className="account-dialog-label" htmlFor="deleteReason">
          Причина
        </label>
        <textarea
          id="deleteReason"
          className="account-dialog-input"
          rows={2}
          maxLength={ADMIN_REASON_MAX_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div>
        <label className="account-dialog-label" htmlFor="deleteLogin">
          Введите логин <strong>{login}</strong>, чтобы подтвердить
        </label>
        <input
          id="deleteLogin"
          className="account-dialog-input"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
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
        <Button variant="danger" type="submit" disabled={busy || !matches || !reason.trim()}>
          {busy ? 'Удаляем…' : 'Удалить аккаунт'}
        </Button>
      </div>
    </form>
  );
}

export function AccountDeleteDialog({ open, login, onClose, onConfirm }: Props) {
  return (
    <Dialog open={open} title="Удалить аккаунт" onClose={onClose}>
      <DeleteForm login={login} onClose={onClose} onConfirm={onConfirm} />
    </Dialog>
  );
}
