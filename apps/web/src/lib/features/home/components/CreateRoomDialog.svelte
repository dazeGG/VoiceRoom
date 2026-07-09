<script lang="ts">
  import { Button, Dialog } from '$lib/shared/ui';
  import { ROOM_PRESETS } from '../model/rooms';

  let { open, creating, onClose, onCreate } = $props<{
    open: boolean;
    creating: boolean;
    onClose: () => void;
    onCreate: (payload: { name: string; roomPresetKey: string; isStatic: boolean }) => void;
  }>();

  let tab = $state<'permanent' | 'temp'>('permanent');
  let name = $state('');
  let roomPresetKey = $state<string>(ROOM_PRESETS[0].key);
  let error = $state('');

  // Reset the form each time the dialog opens.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      tab = 'permanent';
      name = '';
      roomPresetKey = ROOM_PRESETS[0].key;
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
      roomPresetKey: tab === 'permanent' ? roomPresetKey : '',
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
      <div class="lr-field">
        <div class="lr-field-label">Иконка</div>
        <div class="lr-emoji-grid" role="radiogroup" aria-label="Иконка комнаты">
          {#each ROOM_PRESETS as preset (preset.key)}
            <button
              type="button"
              class="lr-emoji-btn"
              role="radio"
              aria-checked={roomPresetKey === preset.key}
              data-active={roomPresetKey === preset.key}
              style={`background:${preset.background}`}
              onclick={() => (roomPresetKey = preset.key)}
            >{preset.emoji}</button>
          {/each}
        </div>
      </div>

      <div class="lr-dialog-note lr-dialog-note--ok">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"></path></svg>
        <span>Всегда остаётся в вашем списке — заходите в любой момент.</span>
      </div>
    {:else}
      <div class="lr-dialog-note lr-dialog-note--warn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>
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
