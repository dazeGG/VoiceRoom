<script lang="ts">
  // Blocking an account: for how long and why. The reason is what the account
  // reads when it tries to sign in.
  import { ADMIN_REASON_MAX_LENGTH } from '@voice-room/shared/contracts/admin';
  import type { BlockDuration } from '$lib/api/admin';
  import { Button, Dialog, SegmentControl } from '$lib/shared/ui';
  import { BLOCK_DURATIONS } from './accounts';

  let {
    open,
    name,
    onClose,
    onConfirm
  }: {
    open: boolean;
    name: string;
    onClose: () => void;
    /** Resolves to an error text, or null once the block is in place. */
    onConfirm: (input: { duration: BlockDuration; reason: string }) => Promise<string | null>;
  } = $props();

  let duration = $state<BlockDuration>('week');
  let reason = $state('');
  let busy = $state(false);
  let error = $state('');

  $effect(() => {
    if (!open) return;
    duration = 'week';
    reason = '';
    error = '';
  });

  function pickDuration(value: BlockDuration): void {
    duration = value;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !reason.trim()) return;
    busy = true;
    error = (await onConfirm({ duration, reason: reason.trim() })) ?? '';
    busy = false;
  }
</script>

<div>
  <Dialog {open} title={`Заблокировать ${name}`} {onClose} width={460} initialFocus="#blockReason">
    <form class="admin-dialog" onsubmit={submit}>
      <p class="admin-dialog-text">
        Аккаунт сразу выйдет со всех устройств и из войса. При входе он увидит срок и причину.
      </p>
      <div>
        <span class="settings-field-label">Срок</span>
        <SegmentControl
          kind="radio"
          options={BLOCK_DURATIONS}
          value={duration}
          onChange={pickDuration}
          ariaLabel="Срок блокировки"
        />
      </div>
      <div>
        <label class="settings-field-label" for="blockReason">Причина</label>
        <textarea
          id="blockReason"
          class="settings-input admin-dialog-reason"
          rows="3"
          maxlength={ADMIN_REASON_MAX_LENGTH}
          placeholder="Например: спам в чатах комнат"
          bind:value={reason}></textarea>
      </div>
      {#if error}<p class="admin-dialog-error" role="alert">{error}</p>{/if}
      <div class="lr-dialog-actions">
        <Button variant="ghost" type="button" onclick={onClose}>Отмена</Button>
        <Button variant="danger" type="submit" disabled={busy || !reason.trim()}>
          {busy ? 'Блокируем…' : 'Заблокировать'}
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
    min-height: 76px;
    padding-top: 8px;
    resize: vertical;
  }
</style>
