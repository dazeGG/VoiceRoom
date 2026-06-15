<script lang="ts">
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import { roomUi, toggleChat } from '../room-ui.svelte';
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
