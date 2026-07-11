<script lang="ts">
  import { Check, Clock } from '@lucide/svelte';
  import { Button, Dialog } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';

  let { open, creating, onClose, onCreate } = $props<{
    open: boolean;
    creating: boolean;
    onClose: () => void;
    onCreate: (payload: { name: string; isStatic: boolean }) => void;
  }>();

  let tab = $state<'permanent' | 'temp'>('permanent');
  let name = $state('');
  let error = $state('');

  // Reset the form each time the dialog opens.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      tab = 'permanent';
      name = '';
      error = '';
    }
    wasOpen = open;
  });

  function submit(event: Event): void {
    event.preventDefault();
    if (creating) return;
    const trimmed = name.trim();
    if (tab === 'permanent' && !trimmed) {
      error = 'Дайте комнате название';
      return;
    }
    onCreate({
      name: trimmed,
      isStatic: tab === 'permanent'
    });
  }
</script>

<Dialog {open} title="Новая комната" {onClose} width={430}>
  <div class="lr-dialog-tabs" role="tablist">
    <button
      class="lr-dialog-tab"
      role="tab"
      aria-selected={tab === 'permanent'}
      data-active={tab === 'permanent'}
      type="button"
      onclick={() => (tab = 'permanent')}
    >Постоянная</button>
    <button
      class="lr-dialog-tab"
      role="tab"
      aria-selected={tab === 'temp'}
      data-active={tab === 'temp'}
      type="button"
      onclick={() => (tab = 'temp')}
    >Временная</button>
  </div>

  <form style="display:flex;flex-direction:column;gap:18px;" onsubmit={submit}>
    {#if error}
      <p class="lr-dialog-error" role="alert">{error}</p>
    {/if}

    <div class="lr-field">
      <div class="lr-field-label">
        Название{#if tab === 'temp'}<span class="lr-field-label-soft"> · необязательно</span>{/if}
      </div>
      <input
        class="lr-dialog-input"
        maxlength="60"
        placeholder={tab === 'permanent' ? 'Название комнаты' : 'Название созвона'}
        bind:value={name}
      />
    </div>

    {#if tab === 'permanent'}
      <div class="lr-dialog-note lr-dialog-note--ok">
        <Check {...iconSm} aria-hidden="true" />
        <span>Всегда остаётся в вашем списке — заходите в любой момент.</span>
      </div>
    {:else}
      <div class="lr-dialog-note lr-dialog-note--warn">
        <Clock {...iconSm} aria-hidden="true" />
        <span>Код появится после создания. После выхода всех участников комната исчезнет примерно через 15 минут.</span>
      </div>
    {/if}

    <div class="lr-dialog-actions">
      <Button variant="ghost" type="button" onclick={onClose}>Отмена</Button>
      <Button variant="primary" type="submit" disabled={creating}>
        {#if creating}<span class="home-spinner" aria-hidden="true"></span>{/if}
        {tab === 'permanent' ? 'Создать комнату' : 'Создать на время'}
      </Button>
    </div>
  </form>
</Dialog>
