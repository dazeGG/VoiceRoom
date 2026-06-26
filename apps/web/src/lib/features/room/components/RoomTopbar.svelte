<script lang="ts">
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import { roomUi, toggleChat } from '../room-ui.svelte';
  import { roomSettingsUi, openRoomSettings } from '../room-settings.svelte';
</script>

<Topbar label="Новая голосовая комната" reload>
  <div class="room-heading topbar-room-heading" aria-label="Комната" hidden>
    <div class="room-heading-main">
      <span class="room-emoji-badge" id="roomEmojiBadge" aria-hidden="true" hidden></span>
      <h1 id="roomTitle">room</h1>
      <button class="room-code-chip" id="copyCodeButton" type="button" aria-label="Скопировать код комнаты">
        <span class="room-code-text" id="roomCodeText"></span>
        <span class="room-code-copy" data-icon="copy" aria-hidden="true"></span>
      </button>
      <button class="room-link-button" id="copyLinkButton" type="button" aria-label="Скопировать ссылку на комнату">
        <span data-icon="link" aria-hidden="true"></span>
        <span>Ссылка</span>
      </button>
      {#if roomSettingsUi.isOwner}
        <button class="room-settings-button" type="button" aria-label="Настройки комнаты" onclick={openRoomSettings}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span>Настройки</span>
        </button>
      {/if}
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
