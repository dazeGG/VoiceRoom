<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Pencil, X } from '@lucide/svelte';
  import type { OwnedRoom } from '$lib/api/auth';
  import { deleteRoom, deleteRoomAvatar, updateRoom, uploadRoomAvatar } from '$lib/api/rooms';
  import { Avatar, AvatarCropDialog } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import ModerationCenter from './ModerationCenter.svelte';
  import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';

  let { room, onClose, onSaved, onDeleted, onToast }: {
    room: OwnedRoom | null;
    onClose: () => void;
    onSaved: () => void;
    onDeleted: () => void;
    onToast: (message: string) => void;
  } = $props();

  let name = $state('');
  let saving = $state(false);
  let deleting = $state(false);
  let confirmDelete = $state(false);
  let error = $state('');
  let avatarInput = $state<HTMLInputElement>();
  let avatarFile = $state<File | null>(null);
  let cropOpen = $state(false);
  let pendingAvatar = $state<Blob | null>(null);
  let avatarPreviewUrl = $state('');
  let removeAvatarPending = $state(false);
  let moderationEnabled = $state(false);

  $effect(() => {
    const activeRoom = room;
    untrack(() => {
      name = activeRoom?.name || '';
      error = '';
      confirmDelete = false;
      avatarFile = null;
      cropOpen = false;
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
      avatarPreviewUrl = '';
      pendingAvatar = null;
      removeAvatarPending = false;
      if (activeRoom) void getCapabilityFeature('moderationCenter').then((enabled) => { moderationEnabled = enabled; });
    });
  });

  onDestroy(() => {
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
  });

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!room || saving || !name.trim()) return;
    saving = true;
    try {
      await updateRoom(room.roomId, { name: name.trim() });
      if (pendingAvatar) await uploadRoomAvatar(room.roomId, pendingAvatar);
      else if (removeAvatarPending) await deleteRoomAvatar(room.roomId);
      onSaved();
      onClose();
      onToast('Комната обновлена');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Не удалось обновить комнату';
    } finally { saving = false; }
  }

  async function remove(): Promise<void> {
    if (!room || deleting) return;
    deleting = true;
    try {
      await deleteRoom(room.roomId);
      onDeleted();
      onClose();
      onToast('Комната удалена');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Не удалось удалить комнату';
      deleting = false;
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
</script>

{#if room}
  <div class="settings-overlay" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
    <div class="settings-modal room-settings-modal" role="dialog" aria-modal="true" aria-label="Настройки комнаты">
      <div class="settings-head"><span class="settings-title">Настройки комнаты</span><button class="settings-close" type="button" aria-label="Закрыть" onclick={onClose}><X {...iconSm} /></button></div>
      <form class="settings-content room-settings-content" onsubmit={save}>
        {#if error}<p class="dialog-error" role="alert">{error}</p>{/if}
        <div class="room-profile-head">
          <div class="room-avatar-control">
            <input bind:this={avatarInput} class="room-avatar-input" type="file" accept="image/jpeg,image/png,image/webp" onchange={onAvatarFile} />
            <button
              class="room-avatar-edit"
              type="button"
              onclick={() => avatarInput?.click()}
              disabled={saving || deleting}
              aria-label={room.avatarUrl ? 'Изменить аватар комнаты' : 'Загрузить аватар комнаты'}
              title={room.avatarUrl ? 'Изменить аватар комнаты' : 'Загрузить аватар комнаты'}
            >
              <Avatar name={name || room.roomId} src={avatarPreviewUrl || (removeAvatarPending ? null : room.avatarUrl)} shape="squircle" background="var(--room-avatar-bg)" size={58} />
              <span class="room-avatar-overlay" aria-hidden="true"><Pencil {...iconSm} /></span>
            </button>
            {#if avatarPreviewUrl || (room.avatarUrl && !removeAvatarPending)}
              <button
                class="room-avatar-remove"
                type="button"
                onclick={removeAvatar}
                disabled={saving || deleting}
                aria-label="Удалить аватар комнаты"
                title="Удалить аватар комнаты"
              ><X {...iconSm} aria-hidden="true" /></button>
            {/if}
          </div>
          <label class="room-name-field"><span class="settings-field-label">Название</span><input class="settings-input" maxlength="60" bind:value={name} /></label>
        </div>
        <div class="settings-actions"><button class="settings-cancel" type="button" onclick={onClose}>Отмена</button><button class="settings-save" type="submit" disabled={saving || !name.trim()}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
        <div class="dialog-danger-zone">
          {#if confirmDelete}
            <p class="dialog-danger-note">Комната будет удалена для всех участников.</p>
            <div class="dialog-danger-actions"><button class="settings-cancel" type="button" onclick={() => (confirmDelete = false)}>Отмена</button><button class="dialog-danger-confirm" type="button" disabled={deleting} onclick={remove}>Удалить навсегда</button></div>
          {:else}<button class="dialog-danger-trigger" type="button" onclick={() => (confirmDelete = true)}>Удалить комнату</button>{/if}
        </div>
      </form>
      {#if moderationEnabled}<div class="room-settings-moderation"><ModerationCenter roomId={room.roomId} /></div>{/if}
    </div>
  </div>
{/if}

<AvatarCropDialog
  open={cropOpen}
  file={avatarFile}
  name={name || room?.name || room?.roomId || ''}
  shape="squircle"
  kind="room"
  title="Аватар комнаты"
  onClose={() => {
    cropOpen = false;
    avatarFile = null;
  }}
  onSave={saveAvatar}
/>

<style>
  .room-settings-modal { width: min(560px, calc(100vw - 28px)); }
  .room-settings-content { display: flex; flex-direction: column; gap: 24px; padding: 26px; }
  .room-settings-moderation { padding: 0 26px 26px; }
  .room-profile-head { display: flex; align-items: center; gap: 16px; }
  .room-name-field { display: grid; flex: 1; gap: 7px; }

  .room-avatar-control { position: relative; flex: none; width: 58px; height: 58px; }
  .room-avatar-input { display: none; }
  .room-avatar-edit { position: relative; display: flex; align-items: center; justify-content: center; width: 58px; height: 58px; padding: 0; overflow: hidden; border: 0; border-radius: 31%; background: transparent; color: #fff; cursor: pointer; }
  .room-avatar-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; border-radius: inherit; background: color-mix(in srgb, var(--warm-950) 58%, transparent); opacity: 0; transition: opacity 0.16s ease; pointer-events: none; }
  .room-avatar-edit:not(:disabled):hover .room-avatar-overlay,
  .room-avatar-edit:not(:disabled):focus-visible .room-avatar-overlay { opacity: 1; }
  .room-avatar-edit:focus-visible { outline: 2px solid var(--coral); outline-offset: 3px; }
  .room-avatar-remove { position: absolute; z-index: 1; top: -5px; right: -5px; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 2px solid var(--paper-deep); border-radius: 50%; background: var(--coral); color: #fff; cursor: pointer; box-shadow: 0 2px 7px rgba(0, 0, 0, 0.34); opacity: 0; transition: opacity 0.16s ease, background 0.16s ease; }
  .room-avatar-control:hover .room-avatar-remove,
  .room-avatar-control:focus-within .room-avatar-remove { opacity: 1; }
  .room-avatar-remove:not(:disabled):hover { background: color-mix(in oklch, var(--coral), var(--warm-950) 16%); }
  .room-avatar-remove:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .room-avatar-edit:disabled,
  .room-avatar-remove:disabled { cursor: default; opacity: 0.6; }

  .dialog-danger-zone { margin-top: 4px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .dialog-danger-trigger { padding: 9px 14px; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 10px; background: transparent; color: #f87171; font-family: var(--font-ui); font-size: 13px; font-weight: 600; cursor: pointer; transition: background-color 0.15s ease, border-color 0.15s ease; }
  .dialog-danger-trigger:hover { border-color: rgba(239, 68, 68, 0.6); background: color-mix(in oklch, var(--coral) 10%, transparent); }
  .dialog-danger-note { margin: 0 0 10px; color: rgba(248, 113, 113, 0.92); font-size: 13px; line-height: 1.45; }
  .dialog-danger-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .dialog-danger-confirm { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border: 0; border-radius: 10px; background: var(--coral); color: #fff; font-family: var(--font-ui); font-size: 13px; font-weight: 600; cursor: pointer; transition: background-color 0.15s ease; }
  .dialog-danger-confirm:hover { background: color-mix(in oklch, var(--coral), var(--warm-950) 20%); }
  .dialog-danger-confirm:disabled,
  .dialog-danger-trigger:disabled { cursor: not-allowed; opacity: 0.6; }
</style>
