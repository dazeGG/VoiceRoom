<script lang="ts">
  import { untrack } from 'svelte';
  import { Ban, SlidersHorizontal, Users, X } from '@lucide/svelte';
  import type { OwnedRoom } from '$lib/api/auth';
  import { deleteRoom, updateRoom } from '$lib/api/rooms';
  import RoomAvatarField from '$lib/entities/room/components/RoomAvatarField.svelte';
  import { saveRoomAvatarChange, type RoomAvatarChange } from '$lib/entities/room/room-avatar-change';
  import { dialogFocusTrap } from '$lib/shared/ui/focus-trap';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import ModerationCenter from '../../../../entities/room/components/ModerationCenter.svelte';
  import RoomMemberList from '../../../../entities/room/components/RoomMemberList.svelte';
  import { BAN_UNDO_DURATION_MS, type ModerationNoticeOptions } from '../../../../entities/room/room-moderation';
  import { dismissToast, type ToastOptions } from '../../model/toasts.svelte';

  type Section = 'general' | 'members' | 'bans';

  let {
    room,
    onClose,
    onSaved,
    onDeleted,
    onToast
  }: {
    room: OwnedRoom | null;
    onClose: () => void;
    onSaved: () => void;
    onDeleted: () => void;
    onToast: (message: string, options?: ToastOptions) => void;
  } = $props();

  let name = $state('');
  let saving = $state(false);
  let deleting = $state(false);
  let confirmDelete = $state(false);
  let error = $state('');
  let avatarChange = $state<RoomAvatarChange>({ kind: 'keep' });
  let cropOpen = $state(false);
  let section = $state<Section>('general');
  // Save waits until the name or the picture actually changes.
  const dirty = $derived(Boolean(room) && (name.trim() !== (room?.name ?? '') || avatarChange.kind !== 'keep'));

  $effect(() => {
    const activeRoom = room;
    untrack(() => {
      name = activeRoom?.name || '';
      error = '';
      confirmDelete = false;
      section = 'general';
      avatarChange = { kind: 'keep' };
      cropOpen = false;
    });
  });

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!room || saving || !name.trim()) return;
    saving = true;
    try {
      await updateRoom(room.roomId, { name: name.trim() });
      await saveRoomAvatarChange(room.roomId, avatarChange);
      onSaved();
      onClose();
      onToast('Комната обновлена');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Не удалось обновить комнату';
    } finally {
      saving = false;
    }
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

  function notifyModeration(message: string, options: ModerationNoticeOptions = {}): void {
    const undo = options.undo;
    onToast(message, {
      variant: options.variant,
      description: options.description,
      duration: undo ? BAN_UNDO_DURATION_MS : undefined,
      // The stack keeps a toast open after its action, so undo closes it first:
      // a second click would otherwise try to lift an already lifted ban.
      actions: undo
        ? [
            {
              label: undo.label,
              onClick: (toastId) => {
                dismissToast(toastId);
                undo.run();
              }
            }
          ]
        : undefined
    });
  }

  // A member menu open inside the dialog owns Escape: it closes the menu, not
  // the whole dialog underneath it.
  function onWindowKeydown(event: KeyboardEvent): void {
    if (!room || cropOpen || event.key !== 'Escape') return;
    if (document.querySelector('.popover-submenu-panel, .popover-panel--floating')) return;
    onClose();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if room}
  <div
    class="settings-overlay"
    role="presentation"
    onclick={(event) => event.target === event.currentTarget && onClose()}
  >
    <div
      class="settings-modal room-settings-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Настройки комнаты"
      tabindex="-1"
      use:dialogFocusTrap={{ enabled: Boolean(room) && !cropOpen }}
    >
      <div class="settings-head">
        <span class="settings-title">Настройки комнаты</span><button
          class="settings-close"
          type="button"
          aria-label="Закрыть"
          onclick={onClose}
          data-dialog-initial-focus><X {...iconSm} /></button
        >
      </div>
      <div class="settings-body room-settings-body">
        <nav class="settings-nav" aria-label="Разделы настроек комнаты">
          <div class="settings-nav-main">
            <button
              class="settings-nav-item"
              type="button"
              data-active={section === 'general'}
              aria-current={section === 'general' ? 'true' : undefined}
              onclick={() => (section = 'general')}><SlidersHorizontal {...iconMd} aria-hidden="true" />Основное</button
            >
            <button
              class="settings-nav-item"
              type="button"
              data-active={section === 'members'}
              aria-current={section === 'members' ? 'true' : undefined}
              onclick={() => (section = 'members')}><Users {...iconMd} aria-hidden="true" />Участники</button
            >
            <button
              class="settings-nav-item"
              type="button"
              data-active={section === 'bans'}
              aria-current={section === 'bans' ? 'true' : undefined}
              onclick={() => (section = 'bans')}><Ban {...iconMd} aria-hidden="true" />Блокировки</button
            >
          </div>
        </nav>

        {#if section === 'members'}
          <div class="settings-content room-settings-content">
            <RoomMemberList roomId={room.roomId} canModerate onNotify={notifyModeration} />
          </div>
        {:else if section === 'bans'}
          <div class="settings-content room-settings-content">
            <ModerationCenter roomId={room.roomId} onNotify={notifyModeration} />
          </div>
        {:else}
          <form class="settings-content room-settings-content" onsubmit={save}>
            {#if error}<p class="dialog-error" role="alert">{error}</p>{/if}
            <div class="room-profile-head">
              {#key room.roomId}
                <RoomAvatarField
                  savedUrl={room.avatarUrl}
                  name={name || room.roomId}
                  disabled={saving || deleting}
                  bind:change={avatarChange}
                  bind:cropping={cropOpen}
                  onError={(message: string) => (error = message)}
                />
              {/key}
              <label class="room-name-field"
                ><span class="settings-field-label">Название</span><input
                  class="settings-input"
                  maxlength="60"
                  bind:value={name}
                /></label
              >
            </div>
            <div class="settings-actions">
              <button class="settings-cancel" type="button" onclick={onClose}>Отмена</button><button
                class="settings-save"
                type="submit"
                disabled={saving || !name.trim() || !dirty}>{saving ? 'Сохраняем…' : 'Сохранить'}</button
              >
            </div>
            <div class="dialog-danger-zone">
              {#if confirmDelete}
                <p class="dialog-danger-note">Комната будет удалена для всех участников.</p>
                <div class="dialog-danger-actions">
                  <button class="settings-cancel" type="button" onclick={() => (confirmDelete = false)}>Отмена</button
                  ><button class="dialog-danger-confirm" type="button" disabled={deleting} onclick={remove}
                    >Удалить навсегда</button
                  >
                </div>
              {:else}<button class="dialog-danger-trigger" type="button" onclick={() => (confirmDelete = true)}
                  >Удалить комнату</button
                >{/if}
            </div>
          </form>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .room-settings-modal {
    width: min(780px, calc(100vw - 28px));
  }
  .room-settings-modal .settings-nav-item {
    gap: 10px;
  }
  /* One height for every section, so switching tabs does not jump. */
  .room-settings-body {
    height: min(532px, calc(90vh - 74px));
    min-height: 0;
  }
  .room-settings-content {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px;
  }
  .room-profile-head {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .room-name-field {
    display: grid;
    flex: 1;
    gap: 7px;
  }

  @media (max-width: 600px) {
    .room-settings-body {
      height: auto;
      overflow-y: auto;
    }
    .room-settings-content {
      padding: 22px 18px;
    }
  }
</style>
