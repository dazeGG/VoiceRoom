<script lang="ts">
  import { Bell, BellOff, ChevronDown, Copy, Link, MessageSquare, Settings } from '@lucide/svelte';
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { Avatar, Ellipsis, Popover, PopoverDivider, PopoverMenuItem } from '$lib/shared/ui';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { getConnectionStatusView } from '../client/ui/status';
  import { copyRoomCode, copyRoomLink } from '../client/room/room';
  import { roomUi, toggleChat } from '../room-ui.svelte';
  import { roomSettingsUi, openRoomSettings } from '../room-settings.svelte';
  import { isRoomNotificationsMuted, updateRoomNotificationsMuted } from '$lib/features/home/model/notification-preferences.svelte';
  import { showToast } from '../client/ui/toast';

  const connection = $derived(getConnectionStatusView());

  // Heading content is derived from the reactive room state — the vanilla client
  // populates roomClientState.room* on join/rename, and these update without imperative DOM writes.
  const heading = $derived(roomClientState.roomName || roomClientState.roomId);
  const roomMuted = $derived(isRoomNotificationsMuted(roomClientState.roomId));
  let muteSaving = $state(false);

  async function handleCopyCode(close: () => void): Promise<void> {
    await copyRoomCode();
    close();
  }

  async function handleCopyLink(close: () => void): Promise<void> {
    await copyRoomLink();
    close();
  }


  async function toggleRoomMute(close: () => void): Promise<void> {
    if (muteSaving) return;
    muteSaving = true;
    try {
      await updateRoomNotificationsMuted(roomClientState.roomId, !roomMuted);
      showToast(roomMuted ? 'Уведомления комнаты включены' : 'Уведомления комнаты выключены');
      close();
    } catch {
      showToast('Не удалось изменить уведомления');
    } finally {
      muteSaving = false;
    }
  }

  function handleOpenSettings(close: () => void): void {
    openRoomSettings();
    close();
  }
</script>

<Topbar label="Новая голосовая комната" reload>
  <div class="room-heading topbar-room-heading" aria-label="Комната" hidden={roomClientState.screen !== 'room'}>
    <div class="room-heading-main">
      <Popover
        placement="bottom-start"
        role="menu"
        ariaLabel="Меню комнаты"
        panelClass="room-heading-popover"
        keepContentMounted
      >
        {#snippet trigger({ open, toggle, panelId })}
          <h1 class="room-heading-title-wrap">
            <button
              class="room-heading-trigger"
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={panelId}
              onclick={toggle}
            >
              <Avatar name={heading} src={roomClientState.roomAvatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={38} />
              <Ellipsis text={heading} title={heading} class="room-heading-title" />
              <span class="room-heading-trigger-chevron" aria-hidden="true">
                <ChevronDown {...iconSm} aria-hidden="true" />
              </span>
            </button>
          </h1>
        {/snippet}

        {#snippet content({ close })}
          <div class="room-heading-popover-head">
            <Avatar name={heading} src={roomClientState.roomAvatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={44} />
            <div class="room-heading-popover-info">
              <Ellipsis text={heading} title={heading} class="room-heading-popover-name" />
              <Ellipsis text={roomClientState.roomId} title={roomClientState.roomId} class="room-heading-popover-code" />
            </div>
          </div>

          <PopoverDivider />

          <PopoverMenuItem label="Скопировать код" onclick={() => void handleCopyCode(close)}>
            {#snippet icon()}
              <Copy {...iconMd} aria-hidden="true" />
            {/snippet}
          </PopoverMenuItem>

          <PopoverMenuItem label="Скопировать ссылку" onclick={() => void handleCopyLink(close)}>
            {#snippet icon()}
              <Link {...iconMd} aria-hidden="true" />
            {/snippet}
          </PopoverMenuItem>

          <PopoverMenuItem label={roomMuted ? 'Включить уведомления' : 'Выключить уведомления'} onclick={() => void toggleRoomMute(close)} disabled={muteSaving}>
            {#snippet icon()}
              {#if roomMuted}<BellOff {...iconMd} aria-hidden="true" />{:else}<Bell {...iconMd} aria-hidden="true" />{/if}
            {/snippet}
          </PopoverMenuItem>

          {#if roomSettingsUi.isOwner}
            <PopoverDivider tight />
            <PopoverMenuItem label="Настройки комнаты" onclick={() => handleOpenSettings(close)}>
              {#snippet icon()}
                <Settings {...iconMd} aria-hidden="true" />
              {/snippet}
            </PopoverMenuItem>
          {/if}
        {/snippet}
      </Popover>
    </div>

    <button
      class="room-chat-toggle"
      type="button"
      aria-pressed={roomUi.chatOpen}
      data-active={roomUi.chatOpen}
      onclick={toggleChat}
      hidden={roomUi.chatOpen}
    >
      <MessageSquare {...iconMd} aria-hidden="true" />
      <span>Чат</span>
      {#if roomUi.unreadChat > 0}
        <span class="room-chat-unread" aria-label={`${roomUi.unreadChat} новых сообщений`}>{roomUi.unreadChat > 99 ? '99+' : roomUi.unreadChat}</span>
      {/if}
    </button>
  </div>

  <div
    class="status-pill"
    data-state={connection.stateName}
    title={connection.title || undefined}
    hidden={connection.stateName === 'idle' || roomClientState.screen !== 'room'}
  >
    <span class="status-dot" aria-hidden="true"></span>
    <span>{connection.label}</span>
  </div>
</Topbar>
