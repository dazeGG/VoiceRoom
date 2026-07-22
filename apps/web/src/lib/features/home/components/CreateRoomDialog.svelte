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
  let permanentTab = $state<HTMLButtonElement>();
  let tempTab = $state<HTMLButtonElement>();

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

  function selectTab(nextTab: 'permanent' | 'temp', focus = false): void {
    tab = nextTab;
    if (focus) queueMicrotask(() => (nextTab === 'permanent' ? permanentTab : tempTab)?.focus());
  }

  function onTabsKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectTab(tab === 'permanent' ? 'temp' : 'permanent', true);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      selectTab(tab === 'permanent' ? 'temp' : 'permanent', true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectTab('permanent', true);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTab('temp', true);
    }
  }
</script>

<Dialog {open} title="Новая комната" {onClose} width={430} initialFocus="#createRoomPermanentTab">
  <div class="lr-dialog-tabs" role="tablist" aria-label="Тип комнаты" tabindex="-1" onkeydown={onTabsKeydown}>
    <button
      bind:this={permanentTab}
      id="createRoomPermanentTab"
      class="lr-dialog-tab"
      role="tab"
      aria-selected={tab === 'permanent'}
      aria-controls="createRoomPermanentPanel"
      data-active={tab === 'permanent'}
      type="button"
      tabindex={tab === 'permanent' ? 0 : -1}
      onclick={() => selectTab('permanent')}
    >Постоянная</button>
    <button
      bind:this={tempTab}
      id="createRoomTempTab"
      class="lr-dialog-tab"
      role="tab"
      aria-selected={tab === 'temp'}
      aria-controls="createRoomTempPanel"
      data-active={tab === 'temp'}
      type="button"
      tabindex={tab === 'temp' ? 0 : -1}
      onclick={() => selectTab('temp')}
    >Временная</button>
  </div>

  <form class="lr-dialog-form" onsubmit={submit}>
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
      <div
        id="createRoomPermanentPanel"
        class="lr-dialog-note lr-dialog-note--ok"
        role="tabpanel"
        aria-labelledby="createRoomPermanentTab"
      >
        <Check {...iconSm} aria-hidden="true" />
        <span>Всегда остаётся в вашем списке — заходите в любой момент.</span>
      </div>
    {:else}
      <div
        id="createRoomTempPanel"
        class="lr-dialog-note lr-dialog-note--warn"
        role="tabpanel"
        aria-labelledby="createRoomTempTab"
      >
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
