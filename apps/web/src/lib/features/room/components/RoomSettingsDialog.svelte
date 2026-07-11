<script lang="ts">
  import { ImagePlus, Trash2, X } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { Avatar, AvatarCropDialog } from '$lib/shared/ui';
  import { deleteRoom, deleteRoomAvatar, updateRoom, uploadRoomAvatar } from '$lib/api/rooms';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { applyRoomUpdated } from '../client/room/lifecycle';
  import { showToast } from '../client/ui/toast';
  import { roomSettingsUi, closeRoomSettings } from '../room-settings.svelte';

  let name = $state('');
  let error = $state('');
  let saving = $state(false);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let avatarInput = $state<HTMLInputElement>();
  let avatarFile = $state<File | null>(null);
  let cropOpen = $state(false);
  let avatarSaving = $state(false);

  // Reset the form from the live room state each time the dialog opens —
  // roomClientState (the vanilla room client's store, aliased to avoid
  // colliding with the $state rune) is not itself reactive, so it is
  // snapshotted here rather than bound continuously.
  let wasOpen = false;
  $effect(() => {
    if (roomSettingsUi.open && !wasOpen) {
      name = roomClientState.roomName;
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
      const room = await updateRoom(roomClientState.roomId, { name: trimmed });
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

  function onAvatarFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const selected = input.files?.[0] ?? null;
    input.value = '';
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      error = 'Выберите изображение JPEG, PNG или WebP';
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      error = 'Изображение должно быть меньше 5 МБ';
      return;
    }
    avatarFile = selected;
    cropOpen = true;
  }

  async function saveAvatar(blob: Blob): Promise<void> {
    avatarSaving = true;
    error = '';
    try {
      const room = await uploadRoomAvatar(roomClientState.roomId, blob);
      applyRoomUpdated(room);
      cropOpen = false;
      avatarFile = null;
      window.dispatchEvent(new CustomEvent('voice-room:rooms-changed', { detail: { roomId: room.roomId } }));
      showToast('Аватар комнаты обновлён');
    } finally {
      avatarSaving = false;
    }
  }

  async function removeAvatar(): Promise<void> {
    if (avatarSaving || !roomClientState.roomAvatarUrl) return;
    avatarSaving = true;
    error = '';
    try {
      const room = await deleteRoomAvatar(roomClientState.roomId);
      applyRoomUpdated(room);
      window.dispatchEvent(new CustomEvent('voice-room:rooms-changed', { detail: { roomId: room.roomId } }));
      showToast('Аватар комнаты удалён');
    } catch (err) {
      error = err instanceof Error && err.message ? err.message : 'Не удалось удалить аватар комнаты';
    } finally {
      avatarSaving = false;
    }
  }

  function onClose(): void {
    if (saving || deleting || avatarSaving || cropOpen) return;
    closeRoomSettings();
  }

  function onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (roomSettingsUi.open && !cropOpen && event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if roomSettingsUi.open}
  <div class="dialog-overlay" role="presentation" onclick={onOverlayClick}>
    <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="roomSettingsTitle">
      <div class="dialog-head">
        <span class="dialog-title" id="roomSettingsTitle">Настройки комнаты</span>
        <button class="dialog-close" type="button" aria-label="Закрыть" onclick={onClose}>
          <X {...iconSm} aria-hidden="true" />
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

        <div class="room-avatar-field">
          <span class="dialog-label">Аватар комнаты</span>
          <div class="room-avatar-row">
            <Avatar name={name || roomClientState.roomId} src={roomClientState.roomAvatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={58} />
            <div class="room-avatar-actions">
              <input bind:this={avatarInput} class="room-avatar-input" type="file" accept="image/jpeg,image/png,image/webp" onchange={onAvatarFile} />
              <button class="room-avatar-upload" type="button" onclick={() => avatarInput?.click()} disabled={avatarSaving}>
                <ImagePlus {...iconSm} aria-hidden="true" />
                {roomClientState.roomAvatarUrl ? 'Заменить' : 'Загрузить'}
              </button>
              {#if roomClientState.roomAvatarUrl}
                <button class="room-avatar-delete" type="button" onclick={removeAvatar} disabled={avatarSaving}>
                  <Trash2 {...iconSm} aria-hidden="true" /> Удалить
                </button>
              {/if}
            </div>
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

<AvatarCropDialog
  open={cropOpen}
  file={avatarFile}
  name={name || roomClientState.roomName || roomClientState.roomId}
  shape="squircle"
  kind="room"
  title="Аватар комнаты"
  onClose={() => {
    if (!avatarSaving) {
      cropOpen = false;
      avatarFile = null;
    }
  }}
  onSave={saveAvatar}
/>

<style>
  .room-avatar-field {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .room-avatar-row,
  .room-avatar-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .room-avatar-input {
    display: none;
  }

  .room-avatar-upload,
  .room-avatar-delete {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 11px;
    border-radius: 9px;
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
  }

  .room-avatar-upload {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: var(--warm-ink-dim);
  }

  .room-avatar-delete {
    border: 1px solid rgba(239, 68, 68, 0.28);
    background: transparent;
    color: #f87171;
  }

  .room-avatar-upload:disabled,
  .room-avatar-delete:disabled {
    cursor: default;
    opacity: 0.6;
  }

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
