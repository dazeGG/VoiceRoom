<script lang="ts">
  // Deleting an account: the login typed again so the wrong one is not
  // deleted by a slip, and a reason. The account is blocked at once and gone
  // after the grace period; until then the deletion can be called off.
  import { ADMIN_REASON_MAX_LENGTH } from '@voice-room/shared/contracts/admin';
  import { Button, Dialog } from '$lib/shared/ui';

  let {
    open,
    login,
    onClose,
    onConfirm
  }: {
    open: boolean;
    login: string;
    onClose: () => void;
    /** Resolves to an error text, or null once the deletion is scheduled. */
    onConfirm: (input: { login: string; reason: string }) => Promise<string | null>;
  } = $props();

  let typed = $state('');
  let reason = $state('');
  let busy = $state(false);
  let error = $state('');

  $effect(() => {
    if (!open) return;
    typed = '';
    reason = '';
    error = '';
  });

  const matches = $derived(typed.trim().toLowerCase() === login);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !matches || !reason.trim()) return;
    busy = true;
    error = (await onConfirm({ login: typed.trim(), reason: reason.trim() })) ?? '';
    busy = false;
  }
</script>

<div>
  <Dialog {open} title="Удалить аккаунт" {onClose} width={480} initialFocus="#deleteReason">
    <form class="admin-dialog" onsubmit={submit}>
      <p class="admin-dialog-text">
        Аккаунт сразу заблокируется навсегда и скроется под именем «Удалённый аккаунт». Через 7 дней удаление станет
        окончательным: комнаты перейдут участникам, сообщения останутся без автора. До этого его можно отменить здесь
        же.
      </p>
      <div>
        <label class="settings-field-label" for="deleteReason">Причина</label>
        <textarea
          id="deleteReason"
          class="settings-input admin-dialog-reason"
          rows="2"
          maxlength={ADMIN_REASON_MAX_LENGTH}
          bind:value={reason}></textarea>
      </div>
      <div>
        <label class="settings-field-label" for="deleteLogin"
          >Введите логин <strong>{login}</strong>, чтобы подтвердить</label
        >
        <input id="deleteLogin" class="settings-input" autocomplete="off" spellcheck="false" bind:value={typed} />
      </div>
      {#if error}<p class="admin-dialog-error" role="alert">{error}</p>{/if}
      <div class="lr-dialog-actions">
        <Button variant="ghost" type="button" onclick={onClose}>Отмена</Button>
        <Button variant="danger" type="submit" disabled={busy || !matches || !reason.trim()}>
          {busy ? 'Удаляем…' : 'Удалить аккаунт'}
        </Button>
      </div>
    </form>
  </Dialog>
</div>

<style>
  .admin-dialog {
    display: grid;
    gap: 14px;
  }

  .admin-dialog-text,
  .admin-dialog-error {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
  }

  .admin-dialog-text {
    color: var(--vr-text-2);
  }

  .admin-dialog-error {
    color: var(--vr-danger);
  }

  .admin-dialog-reason {
    height: auto;
    min-height: 56px;
    padding-top: 8px;
    resize: vertical;
  }
</style>
