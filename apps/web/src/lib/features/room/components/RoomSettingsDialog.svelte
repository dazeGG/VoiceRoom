<script lang="ts">
  import { Ban, ChevronDown, SlidersHorizontal, Users, X } from '@lucide/svelte';
  import '$lib/shared/styles/settings.css';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { dialogFocusTrap } from '$lib/shared/ui/focus-trap';
  import { deleteRoom, updateRoom } from '$lib/api/rooms';
  import RoomAvatarField from '$lib/entities/room/components/RoomAvatarField.svelte';
  import { saveRoomAvatarChange, type RoomAvatarChange } from '$lib/entities/room/room-avatar-change';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { applyRoomUpdated } from '../client/room/lifecycle';
  import { showToast } from '../client/ui/toast';
  import { roomSettingsUi, closeRoomSettings } from '../room-settings.svelte';
  import ModerationCenter from '$lib/entities/room/components/ModerationCenter.svelte';
  import RoomMemberList from '$lib/entities/room/components/RoomMemberList.svelte';
  import { BAN_UNDO_DURATION_MS, type ModerationNoticeOptions } from '$lib/entities/room/room-moderation';
  import {
    fetchRoomNotificationLevel,
    setRoomNotificationLevel,
    type RoomNotificationLevel
  } from '$lib/api/notifications';

  type Section = 'general' | 'members' | 'bans';

  let name = $state('');
  let error = $state('');
  let saving = $state(false);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let avatarChange = $state<RoomAvatarChange>({ kind: 'keep' });
  let cropOpen = $state(false);
  let notificationLevel = $state<RoomNotificationLevel>('mentions');
  let notificationSaving = $state(false);
  let section = $state<Section>('general');

  // Reset the form from the live room state each time the dialog opens —
  // roomClientState (the vanilla room client's store, aliased to avoid
  // colliding with the $state rune) is not itself reactive, so it is
  // snapshotted here rather than bound continuously.
  let wasOpen = false;
  $effect(() => {
    if (roomSettingsUi.open && !wasOpen) {
      void fetchRoomNotificationLevel(roomClientState.roomId)
        .catch(() => 'mentions' as const)
        .then((level) => (notificationLevel = level));
      section = 'general';
      name = roomClientState.roomName;
      error = '';
      confirmingDelete = false;
      avatarChange = { kind: 'keep' };
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
      room = (await saveRoomAvatarChange(roomClientState.roomId, avatarChange)) ?? room;
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

  async function saveNotificationLevel(event: Event): Promise<void> {
    notificationLevel = (event.currentTarget as HTMLSelectElement).value as RoomNotificationLevel;
    notificationSaving = true;
    try {
      await setRoomNotificationLevel(roomClientState.roomId, notificationLevel);
    } catch (value) {
      error = value instanceof Error ? value.message : 'Не удалось сохранить уведомления';
    } finally {
      notificationSaving = false;
    }
  }

  function notifyModeration(message: string, options: ModerationNoticeOptions = {}): void {
    showToast(message, {
      variant: options.variant,
      actionLabel: options.undo?.label,
      action: options.undo?.run,
      duration: options.undo ? BAN_UNDO_DURATION_MS : undefined
    });
  }

  function onClose(): void {
    if (saving || deleting || cropOpen) return;
    closeRoomSettings();
  }

  function onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }

  // A member menu open inside the dialog owns Escape: it closes the menu, not
  // the whole dialog underneath it.
  function hasOpenPopover(): boolean {
    return Boolean(document.querySelector('.popover-submenu-panel, .popover-panel--floating'));
  }

  function onKeydown(event: KeyboardEvent): void {
    if (roomSettingsUi.open && !cropOpen && event.key === 'Escape' && !hasOpenPopover()) onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if roomSettingsUi.open}
  <div class="settings-overlay" role="presentation" onclick={onOverlayClick}>
    <div
      class="settings-modal room-settings-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="roomSettingsTitle"
      tabindex="-1"
      use:dialogFocusTrap={{ enabled: roomSettingsUi.open && !cropOpen }}
    >
      <div class="settings-head">
        <span class="settings-title" id="roomSettingsTitle">Настройки комнаты</span>
        <button class="settings-close" type="button" aria-label="Закрыть" onclick={onClose} data-dialog-initial-focus>
          <X {...iconSm} aria-hidden="true" />
        </button>
      </div>

      <div class="settings-body room-settings-body">
        <nav class="settings-nav" aria-label="Разделы настроек комнаты">
          <div class="settings-nav-main">
            <button
              class="settings-nav-item"
              type="button"
              data-active={section === 'general'}
              aria-current={section === 'general' ? 'true' : undefined}
              onclick={() => (section = 'general')}
            >
              <SlidersHorizontal {...iconMd} aria-hidden="true" />
              Основное
            </button>
            <button
              class="settings-nav-item"
              type="button"
              data-active={section === 'members'}
              aria-current={section === 'members' ? 'true' : undefined}
              onclick={() => (section = 'members')}
            >
              <Users {...iconMd} aria-hidden="true" />
              Участники
            </button>
            <button
              class="settings-nav-item"
              type="button"
              data-active={section === 'bans'}
              aria-current={section === 'bans' ? 'true' : undefined}
              onclick={() => (section = 'bans')}
            >
              <Ban {...iconMd} aria-hidden="true" />
              Блокировки
            </button>
          </div>
        </nav>

        {#if section === 'members'}
          <div class="settings-content room-settings-content">
            <RoomMemberList roomId={roomClientState.roomId} canModerate onNotify={notifyModeration} />
          </div>
        {:else if section === 'bans'}
          <div class="settings-content room-settings-content">
            <ModerationCenter roomId={roomClientState.roomId} onNotify={notifyModeration} />
          </div>
        {:else}
          <form class="settings-content room-settings-content" onsubmit={save}>
            {#if error}
              <p class="dialog-error" role="alert">{error}</p>
            {/if}

            <div class="room-profile-head">
              <RoomAvatarField
                savedUrl={roomClientState.roomAvatarUrl}
                name={name || roomClientState.roomId}
                bind:change={avatarChange}
                bind:cropping={cropOpen}
                onError={(message: string) => (error = message)}
              />
              <label class="room-name-field">
                <span class="settings-field-label">Название</span>
                <input class="settings-input" maxlength="60" placeholder="Название комнаты" bind:value={name} />
              </label>
            </div>

            <label class="room-settings-notifications">
              <span class="settings-field-label">Уведомления комнаты</span>
              <span class="settings-select-wrap">
                <select
                  class="settings-select"
                  value={notificationLevel}
                  onchange={saveNotificationLevel}
                  disabled={notificationSaving}
                >
                  <option value="all">Все сообщения</option>
                  <option value="mentions">Упоминания и ответы</option>
                  <option value="none">Выключены</option>
                </select>
                <span class="settings-select-chevron" aria-hidden="true"><ChevronDown {...iconSm} /></span>
              </span>
            </label>

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
                <p class="dialog-danger-note">
                  Комната будет удалена для всех участников. Это действие нельзя отменить.
                </p>
                <div class="dialog-danger-actions">
                  <button
                    class="settings-cancel"
                    type="button"
                    onclick={() => (confirmingDelete = false)}
                    disabled={deleting}>Отмена</button
                  >
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
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .room-settings-modal {
    width: 780px;
  }
  /* One height for every section, so switching tabs does not jump. */
  .room-settings-body {
    height: min(560px, calc(90vh - 74px));
    min-height: 0;
  }
  .room-settings-content {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 28px 30px 30px;
  }
  .room-settings-notifications {
    display: grid;
  }
  .room-settings-notifications .settings-field-label {
    margin-bottom: 9px;
  }
  .room-profile-head {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .room-name-field {
    flex: 1;
    min-width: 0;
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

  .dialog-danger-zone {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin-top: 4px;
    padding-top: 14px;
  }

  .dialog-danger-trigger {
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 10px;
    color: var(--vr-danger);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 14px;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease;
  }

  .dialog-danger-trigger:hover {
    background: color-mix(in oklch, var(--vr-danger) 10%, transparent);
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
    background: var(--vr-danger);
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
    background: color-mix(in oklch, var(--vr-danger), var(--vr-bg) 20%);
  }

  .dialog-danger-confirm:disabled,
  .dialog-danger-trigger:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  :global(.settings-select-wrap) {
    position: relative;
  }
  :global(.settings-select) {
    width: 100%;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    padding: 13px 40px 13px 15px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: var(--vr-bg);
    color: var(--vr-text);
    font-family: var(--font-ui);
    font-size: 14.5px;
    font-weight: 500;
    outline: none;
    cursor: pointer;
  }
  :where(.settings-select) option {
    background: var(--vr-surface-2);
    color: var(--vr-text);
  }
  :global(.settings-select-chevron) {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    pointer-events: none;
    color: var(--vr-text-2);
  }
</style>
