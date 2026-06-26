<script lang="ts">
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import Popover from '$lib/shared/components/Popover.svelte';
  import PopoverDivider from '$lib/shared/components/PopoverDivider.svelte';
  import PopoverMenuItem from '$lib/shared/components/PopoverMenuItem.svelte';
  import { copyRoomCode, copyRoomLink } from '../client/room/room';
  import { roomUi, toggleChat } from '../room-ui.svelte';
  import { roomSettingsUi, openRoomSettings } from '../room-settings.svelte';

  async function handleCopyCode(close: () => void): Promise<void> {
    await copyRoomCode();
    close();
  }

  async function handleCopyLink(close: () => void): Promise<void> {
    await copyRoomLink();
    close();
  }

  function handleOpenSettings(close: () => void): void {
    openRoomSettings();
    close();
  }
</script>

<Topbar label="Новая голосовая комната" reload>
  <div class="room-heading topbar-room-heading" aria-label="Комната" hidden>
    <div class="room-heading-main">
      <Popover placement="bottom-start" role="menu" ariaLabel="Меню комнаты" panelClass="room-heading-popover">
        {#snippet trigger({ open, toggle, panelId })}
          <button
            class="room-heading-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={panelId}
            onclick={toggle}
          >
            <span class="room-emoji-badge" id="roomEmojiBadge" aria-hidden="true" hidden></span>
            <span id="roomTitle" class="room-heading-title">room</span>
            <span class="room-heading-trigger-chevron" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </span>
          </button>
        {/snippet}

        {#snippet content({ close })}
          <div class="room-heading-popover-meta">
            <span class="room-heading-popover-label">Код комнаты</span>
            <span class="room-code-text" id="roomCodeText"></span>
          </div>

          <PopoverDivider />

          <PopoverMenuItem label="Скопировать код" onclick={() => void handleCopyCode(close)}>
            {#snippet icon()}
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/snippet}
          </PopoverMenuItem>

          <PopoverMenuItem label="Скопировать ссылку" onclick={() => void handleCopyLink(close)}>
            {#snippet icon()}
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            {/snippet}
          </PopoverMenuItem>

          {#if roomSettingsUi.isOwner}
            <PopoverDivider tight />
            <PopoverMenuItem label="Настройки комнаты" onclick={() => handleOpenSettings(close)}>
              {#snippet icon()}
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"></path></svg>
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
      <span data-icon="chat" aria-hidden="true"></span>
      <span>Чат</span>
      {#if roomUi.unreadChat > 0}
        <span class="room-chat-unread" aria-label={`${roomUi.unreadChat} новых сообщений`}>{roomUi.unreadChat > 99 ? '99+' : roomUi.unreadChat}</span>
      {/if}
    </button>
  </div>

  <div class="status-pill" data-state="idle" id="statusPill" hidden>
    <span class="status-dot" aria-hidden="true"></span>
    <span id="statusText">готово</span>
  </div>
</Topbar>