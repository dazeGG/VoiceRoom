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
      onclick={() => selectTab('permanent')}>Постоянная</button
    >
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
      onclick={() => selectTab('temp')}>Временная</button
    >
  </div>

  <form class="lr-dialog-form" onsubmit={submit}>
    {#if error}
      <p class="lr-dialog-error" role="alert">{error}</p>
    {/if}

    <div class="lr-field">
      <label class="lr-field-label" for="createRoomName">
        Название{#if tab === 'temp'}<span class="lr-field-label-soft"> · необязательно</span>{/if}
      </label>
      <input
        id="createRoomName"
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

<style>
  :global(.lr-dialog-form) {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  :global(.lr-field) {
    margin-bottom: 4px;
  }
  :global(.lr-field-label) {
    display: block;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--vr-text-2);
    margin-bottom: 8px;
  }
  :global(.lr-field-label-soft) {
    color: var(--vr-text-3);
    font-weight: 500;
  }
  :global(.lr-dialog-input) {
    width: 100%;
    border: 1px solid var(--vr-line-strong);
    border-radius: var(--radius-md);
    padding: 13px 15px;
    background: var(--vr-bg);
    color: var(--vr-text);
    font-family: var(--font-ui);
    font-size: 15px;
    outline: none;
    transition: border-color 0.15s ease;
  }
  :where(.lr-dialog-input)::placeholder {
    color: var(--vr-text-3);
  }
  :where(.lr-dialog-input):focus {
    border-color: var(--vr-accent);
  }
  :global(.lr-dialog-tabs) {
    display: flex;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--vr-line);
    border-radius: var(--radius-md);
    background: var(--vr-bg);
  }
  :global(.lr-dialog-note) {
    display: flex;
    align-items: center;
    gap: 9px;
    border-radius: var(--radius-md);
    padding: 11px 13px;
    font-size: 12.5px;
    line-height: 1.4;
  }
  :global(.lr-dialog-note svg) {
    flex: none;
  }
  :global(.lr-dialog-note--ok) {
    border: 1px solid color-mix(in oklch, var(--vr-online), transparent 78%);
    background: color-mix(in oklch, var(--vr-online), transparent 92%);
    color: var(--vr-text);
  }
  :global(.lr-dialog-note--ok svg) {
    stroke: var(--vr-online);
  }
  :global(.lr-dialog-note--warn) {
    border: 1px solid color-mix(in oklch, var(--vr-away), transparent 72%);
    background: color-mix(in oklch, var(--vr-away), transparent 90%);
    color: var(--vr-text);
  }
  :global(.lr-dialog-note--warn svg) {
    stroke: var(--vr-away);
  }
  :global(.lr-dialog-error) {
    margin: 0;
    border: 1px solid color-mix(in oklch, var(--vr-danger), transparent 60%);
    border-radius: var(--radius-md);
    padding: 9px 12px;
    background: color-mix(in oklch, var(--vr-danger), transparent 88%);
    color: var(--vr-text);
    font-size: 12.5px;
  }
</style>
