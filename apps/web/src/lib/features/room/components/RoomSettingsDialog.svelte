<script lang="ts">
  import { ROOM_PRESETS } from '$lib/visual/tokens';
  import { deleteRoom, updateRoom } from '$lib/api/rooms';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { applyRoomUpdated } from '../client/room/lifecycle';
  import { showToast } from '../client/ui/toast';
  import { roomSettingsUi, closeRoomSettings } from '../room-settings.svelte';

  let name = $state('');
  let roomPresetKey = $state<string>(ROOM_PRESETS[0].key);
  let error = $state('');
  let saving = $state(false);
  let confirmingDelete = $state(false);
  let deleting = $state(false);

  // Reset the form from the live room state each time the dialog opens —
  // roomClientState (the vanilla room client's store, aliased to avoid
  // colliding with the $state rune) is not itself reactive, so it is
  // snapshotted here rather than bound continuously.
  let wasOpen = false;
  $effect(() => {
    if (roomSettingsUi.open && !wasOpen) {
      name = roomClientState.roomName;
      roomPresetKey = roomClientState.roomPresetKey || ROOM_PRESETS[0].key;
      error = '';
      confirmingDelete = false;
    }
    wasOpen = roomSettingsUi.open;
  });

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      error = 'Дайте комнате название';
      return;
    }

    saving = true;
    error = '';
    try {
      const room = await updateRoom(roomClientState.roomId, { name: trimmed, roomPresetKey });
      applyRoomUpdated(room);
      closeRoomSettings();
      showToast('Комната обновлена');
    } catch (err) {
      error = err instanceof Error && err.message ? err.message : 'Не удалось сохранить изменения';
    } finally {
      saving = false;
    }
  }

  async function confirmDelete(): Promise<void> {
    if (deleting) return;
    deleting = true;
    roomSettingsUi.deleting = true;
    try {
      await deleteRoom(roomClientState.roomId);
      window.location.href = '/';
    } catch (err) {
      deleting = false;
      roomSettingsUi.deleting = false;
      error = err instanceof Error && err.message ? err.message : 'Не удалось удалить комнату';
    }
  }

  function onClose(): void {
    if (saving || deleting) return;
    closeRoomSettings();
  }

  function onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (roomSettingsUi.open && event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if roomSettingsUi.open}
  <div class="dialog-overlay" role="presentation" onclick={onOverlayClick}>
    <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="roomSettingsTitle">
      <div class="dialog-head">
        <span class="dialog-title" id="roomSettingsTitle">Настройки комнаты</span>
        <button class="dialog-close" type="button" aria-label="Закрыть" onclick={onClose}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
        </button>
      </div>

      <form class="dialog-body" onsubmit={save}>
        {#if error}
          <p class="dialog-error" role="alert">{error}</p>
        {/if}

        <div class="dialog-field">
          <div class="dialog-label">Название</div>
          <input class="dialog-input" maxlength="60" placeholder="Название комнаты" bind:value={name} />
        </div>

        <div class="dialog-field">
          <div class="dialog-label">Иконка</div>
          <div class="dialog-emoji-row" role="radiogroup" aria-label="Иконка комнаты">
            {#each ROOM_PRESETS as preset (preset.key)}
              <button
                type="button"
                class="dialog-emoji"
                role="radio"
                aria-checked={roomPresetKey === preset.key}
                data-active={roomPresetKey === preset.key}
                style={`background:${preset.background}`}
                onclick={() => (roomPresetKey = preset.key)}
              >{preset.emoji}</button>
            {/each}
          </div>
        </div>

        <div class="dialog-actions">
          <button class="dialog-cancel" type="button" onclick={onClose}>Отмена</button>
          <button class="dialog-submit" type="submit" disabled={saving}>
            {#if saving}
              <span class="home-spinner" aria-hidden="true"></span>
            {/if}
            Сохранить
          </button>
        </div>

        <div class="dialog-danger-zone">
          {#if confirmingDelete}
            <p class="dialog-danger-note">Комната будет удалена для всех участников. Это действие нельзя отменить.</p>
            <div class="dialog-danger-actions">
              <button class="dialog-cancel" type="button" onclick={() => (confirmingDelete = false)} disabled={deleting}>Отмена</button>
              <button class="dialog-danger-confirm" type="button" onclick={confirmDelete} disabled={deleting}>
                {#if deleting}
                  <span class="home-spinner" aria-hidden="true"></span>
                {/if}
                Удалить навсегда
              </button>
            </div>
          {:else}
            <button class="dialog-danger-trigger" type="button" onclick={() => (confirmingDelete = true)}>
              Удалить комнату
            </button>
          {/if}
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .dialog-danger-zone {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin-top: 4px;
    padding-top: 14px;
  }

  .dialog-danger-trigger {
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 10px;
    color: #f87171;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 14px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .dialog-danger-trigger:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.6);
  }

  .dialog-danger-note {
    color: rgba(248, 113, 113, 0.92);
    font-size: 13px;
    line-height: 1.45;
    margin: 0 0 10px;
  }

  .dialog-danger-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .dialog-danger-confirm {
    align-items: center;
    background: #ef4444;
    border: none;
    border-radius: 10px;
    color: #fff;
    cursor: pointer;
    display: inline-flex;
    font-size: 13px;
    font-weight: 600;
    gap: 6px;
    padding: 9px 14px;
    transition: background-color 0.15s ease;
  }

  .dialog-danger-confirm:hover {
    background: #dc2626;
  }

  .dialog-danger-confirm:disabled,
  .dialog-danger-trigger:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
