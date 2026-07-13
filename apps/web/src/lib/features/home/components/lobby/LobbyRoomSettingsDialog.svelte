<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { OwnedRoom } from '$lib/api/auth';
  import { deleteRoom, updateRoom } from '$lib/api/rooms';
  import { Avatar } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';

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

  $effect(() => {
    name = room?.name || '';
    error = '';
    confirmDelete = false;
  });

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!room || saving || !name.trim()) return;
    saving = true;
    try {
      await updateRoom(room.roomId, { name: name.trim() });
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
</script>

{#if room}
  <div class="settings-overlay" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
    <div class="settings-modal room-settings-modal" role="dialog" aria-modal="true" aria-label="Настройки комнаты">
      <div class="settings-head"><span class="settings-title">Настройки комнаты</span><button class="settings-close" type="button" aria-label="Закрыть" onclick={onClose}><X {...iconSm} /></button></div>
      <form class="settings-content room-settings-content" onsubmit={save}>
        {#if error}<p class="dialog-error" role="alert">{error}</p>{/if}
        <div class="room-profile-head">
          <Avatar name={name || room.roomId} src={room.avatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={58} />
          <label class="room-name-field"><span class="settings-field-label">Название</span><input class="settings-input" maxlength="60" bind:value={name} /></label>
        </div>
        <div class="settings-actions"><button class="settings-cancel" type="button" onclick={onClose}>Отмена</button><button class="settings-save" type="submit" disabled={saving || !name.trim()}>Сохранить</button></div>
        <div class="dialog-danger-zone">
          {#if confirmDelete}
            <p class="dialog-danger-note">Комната будет удалена для всех участников.</p>
            <div class="dialog-danger-actions"><button class="settings-cancel" type="button" onclick={() => (confirmDelete = false)}>Отмена</button><button class="dialog-danger-confirm" type="button" disabled={deleting} onclick={remove}>Удалить навсегда</button></div>
          {:else}<button class="dialog-danger-trigger" type="button" onclick={() => (confirmDelete = true)}>Удалить комнату</button>{/if}
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .room-settings-modal { width: min(560px, calc(100vw - 28px)); }
  .room-settings-content { display: flex; flex-direction: column; gap: 24px; padding: 26px; }
  .room-profile-head { display: flex; align-items: center; gap: 16px; }
  .room-name-field { display: grid; flex: 1; gap: 7px; }
</style>
