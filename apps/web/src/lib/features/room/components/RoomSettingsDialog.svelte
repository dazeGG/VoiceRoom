<script lang="ts">
  import { Pencil, X } from '@lucide/svelte';
  import '$lib/features/home/styles/settings.css';
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
  let pendingAvatar = $state<Blob | null>(null);
  let avatarPreviewUrl = $state('');
  let removeAvatarPending = $state(false);

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
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
      avatarPreviewUrl = '';
      pendingAvatar = null;
      removeAvatarPending = false;
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
      let room = await updateRoom(roomClientState.roomId, { name: trimmed });
      if (pendingAvatar) room = await uploadRoomAvatar(roomClientState.roomId, pendingAvatar);
      else if (removeAvatarPending) room = await deleteRoomAvatar(roomClientState.roomId);
      applyRoomUpdated(room);
      window.dispatchEvent(new CustomEvent('voice-room:rooms-changed', { detail: { roomId: room.roomId } }));
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
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    pendingAvatar = blob;
    avatarPreviewUrl = URL.createObjectURL(blob);
    removeAvatarPending = false;
    cropOpen = false;
    avatarFile = null;
  }

  function removeAvatar(): void {
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    avatarPreviewUrl = '';
    pendingAvatar = null;
    removeAvatarPending = true;
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
  <div class="settings-overlay" role="presentation" onclick={onOverlayClick}>
    <div class="settings-modal room-settings-modal" role="dialog" aria-modal="true" aria-labelledby="roomSettingsTitle">
      <div class="settings-head">
        <span class="settings-title" id="roomSettingsTitle">Настройки комнаты</span>
        <button class="settings-close" type="button" aria-label="Закрыть" onclick={onClose}>
          <X {...iconSm} aria-hidden="true" />
        </button>
      </div>

      <form class="settings-content room-settings-content" onsubmit={save}>
        {#if error}
          <p class="dialog-error" role="alert">{error}</p>
        {/if}

        <div class="room-profile-head">
        <div class="room-avatar-field">
          <div class="room-avatar-control">
            <input bind:this={avatarInput} class="room-avatar-input" type="file" accept="image/jpeg,image/png,image/webp" onchange={onAvatarFile} />
            <button
              class="room-avatar-edit"
              type="button"
              onclick={() => avatarInput?.click()}
              disabled={avatarSaving}
              aria-label={roomClientState.roomAvatarUrl ? 'Изменить аватар комнаты' : 'Загрузить аватар комнаты'}
              title={roomClientState.roomAvatarUrl ? 'Изменить аватар комнаты' : 'Загрузить аватар комнаты'}
            >
              <Avatar name={name || roomClientState.roomId} src={avatarPreviewUrl || (removeAvatarPending ? null : roomClientState.roomAvatarUrl)} shape="squircle" background="var(--room-avatar-bg)" size={58} />
              <span class="room-avatar-overlay" aria-hidden="true">
                <Pencil {...iconSm} />
              </span>
            </button>
            {#if avatarPreviewUrl || (roomClientState.roomAvatarUrl && !removeAvatarPending)}
              <button
                class="room-avatar-remove"
                type="button"
                onclick={removeAvatar}
                disabled={avatarSaving}
                aria-label="Удалить аватар комнаты"
                title="Удалить аватар комнаты"
              >
                <X {...iconSm} aria-hidden="true" />
              </button>
            {/if}
          </div>
        </div>
        <div class="room-name-field">
          <span class="settings-field-label">Название</span>
          <input class="settings-input" maxlength="60" placeholder="Название комнаты" bind:value={name} />
        </div>
        </div>

        <div class="settings-actions">
          <button class="settings-cancel" type="button" onclick={onClose}>Отмена</button>
          <button class="settings-save" type="submit" disabled={saving}>
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
              <button class="settings-cancel" type="button" onclick={() => (confirmingDelete = false)} disabled={deleting}>Отмена</button>
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
  .room-settings-modal { width: 620px; }
  .room-settings-content { display: flex; flex-direction: column; gap: 28px; padding: 28px 30px 30px; }
  .room-profile-head { display: flex; align-items: center; gap: 16px; }
  .room-name-field { flex: 1; min-width: 0; }
  .room-avatar-field { flex: none; }

  .room-avatar-control {
    position: relative;
    width: 58px;
    height: 58px;
  }

  .room-avatar-edit {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 58px;
    height: 58px;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 31%;
    background: transparent;
    color: #fff;
    cursor: pointer;
  }

  .room-avatar-input {
    display: none;
  }

  .room-avatar-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: inherit;
    background: rgba(20, 16, 14, 0.58);
    opacity: 0;
    transition: opacity 0.16s ease;
    pointer-events: none;
  }

  .room-avatar-edit:not(:disabled):hover .room-avatar-overlay,
  .room-avatar-edit:not(:disabled):focus-visible .room-avatar-overlay {
    opacity: 1;
  }

  .room-avatar-edit:focus-visible {
    outline: 2px solid var(--coral);
    outline-offset: 3px;
  }

  .room-avatar-remove {
    position: absolute;
    z-index: 1;
    top: -5px;
    right: -5px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 2px solid var(--paper-deep);
    border-radius: 50%;
    background: #dc5f4b;
    color: #fff;
    cursor: pointer;
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.34);
    opacity: 0;
    transition: opacity 0.16s ease, background 0.16s ease;
  }

  .room-avatar-control:hover .room-avatar-remove,
  .room-avatar-control:focus-within .room-avatar-remove { opacity: 1; }

  .room-avatar-remove:not(:disabled):hover {
    background: #c94e3b;
  }

  .room-avatar-remove:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  .room-avatar-edit:disabled,
  .room-avatar-remove:disabled {
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
