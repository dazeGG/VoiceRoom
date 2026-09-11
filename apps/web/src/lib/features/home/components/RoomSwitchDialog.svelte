<script lang="ts">
  import { Button, Dialog } from '$lib/shared/ui';

  let { open, fromName, toName, onConfirm, onCancel } = $props<{
    open: boolean;
    fromName: string;
    toName: string;
    onConfirm: (dontAskAgain: boolean) => void;
    onCancel: () => void;
  }>();

  let dontAskAgain = $state(false);

  $effect(() => {
    if (open) dontAskAgain = false;
  });
</script>

<Dialog {open} title={`Перейти в комнату «${toName}»?`} onClose={onCancel} width={430}>
  <p class="room-switch-text">Вы покинете звонок в «{fromName}».</p>
  <label class="room-switch-remember">
    <input type="checkbox" bind:checked={dontAskAgain} />
    <span>Больше не спрашивать</span>
  </label>
  <div class="lr-dialog-actions">
    <Button variant="ghost" type="button" onclick={onCancel}>Отмена</Button>
    <Button variant="primary" type="button" onclick={() => onConfirm(dontAskAgain)}>Перейти</Button>
  </div>
</Dialog>

<style>
  .room-switch-text {
    margin: 0;
    color: var(--warm-muted);
    font-size: 14px;
    line-height: 1.45;
  }

  .room-switch-remember {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--warm-ink);
    font-size: 14px;
    cursor: pointer;
  }

  .room-switch-remember input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--accent, currentColor);
  }
</style>
