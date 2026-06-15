<script lang="ts">
  import { ROOM_EMOJIS } from '../model/rooms';

  let { open, creating, onClose, onCreate } = $props<{
    open: boolean;
    creating: boolean;
    onClose: () => void;
    onCreate: (payload: { name: string; emoji: string; isStatic: boolean }) => void;
  }>();

  let tab = $state<'permanent' | 'temp'>('permanent');
  let name = $state('');
  let emoji = $state<string>(ROOM_EMOJIS[0]);
  let error = $state('');

  // Reset the form each time the dialog opens.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      tab = 'permanent';
      name = '';
      emoji = ROOM_EMOJIS[0];
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
      emoji: tab === 'permanent' ? emoji : '',
      isStatic: tab === 'permanent'
    });
  }

  function onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="dialog-overlay" role="presentation" onclick={onOverlayClick}>
    <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="createRoomTitle">
      <div class="dialog-head">
        <span class="dialog-title" id="createRoomTitle">Новая комната</span>
        <button class="dialog-close" type="button" aria-label="Закрыть" onclick={onClose}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
        </button>
      </div>

      <div class="dialog-tabs" role="tablist">
        <button
          class="dialog-tab"
          role="tab"
          aria-selected={tab === 'permanent'}
          data-active={tab === 'permanent'}
          type="button"
          onclick={() => (tab = 'permanent')}
        >Постоянная</button>
        <button
          class="dialog-tab dialog-tab--temp"
          role="tab"
          aria-selected={tab === 'temp'}
          data-active={tab === 'temp'}
          type="button"
          onclick={() => (tab = 'temp')}
        >Временная</button>
      </div>

      <form class="dialog-body" onsubmit={submit}>
        {#if error}
          <p class="dialog-error" role="alert">{error}</p>
        {/if}

        <div class="dialog-field">
          <div class="dialog-label">
            Название{#if tab === 'temp'}<span class="dialog-label-soft"> · необязательно</span>{/if}
          </div>
          <input
            class="dialog-input"
            maxlength="60"
            placeholder={tab === 'permanent' ? 'например, квартирник' : 'быстрый созвон'}
            bind:value={name}
          />
        </div>

        {#if tab === 'permanent'}
          <div class="dialog-field">
            <div class="dialog-label">Иконка</div>
            <div class="dialog-emoji-row" role="radiogroup" aria-label="Иконка комнаты">
              {#each ROOM_EMOJIS as item (item)}
                <button
                  type="button"
                  class="dialog-emoji"
                  role="radio"
                  aria-checked={emoji === item}
                  data-active={emoji === item}
                  onclick={() => (emoji = item)}
                >{item}</button>
              {/each}
            </div>
          </div>

          <div class="dialog-note dialog-note--ok">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"></path></svg>
            <span>Всегда остаётся в вашем списке — заходите в любой момент.</span>
          </div>
        {:else}
          <div class="dialog-note dialog-note--warn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>
            <span>Код появится после создания. После выхода всех участников комната исчезнет примерно через 15 минут.</span>
          </div>
        {/if}

        <div class="dialog-actions">
          <button class="dialog-cancel" type="button" onclick={onClose}>Отмена</button>
          <button class="dialog-submit" type="submit" disabled={creating}>
            {#if creating}
              <span class="home-spinner" aria-hidden="true"></span>
            {/if}
            {tab === 'permanent' ? 'Создать комнату' : 'Создать на время'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
