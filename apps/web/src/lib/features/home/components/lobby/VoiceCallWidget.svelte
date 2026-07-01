<script lang="ts">
  let {
    roomName = '',
    muted = false,
    deafened = false,
    onOpen,
    onToggleMic,
    onToggleDeafen,
    onLeave
  } = $props<{
    roomName?: string;
    muted?: boolean;
    deafened?: boolean;
    onOpen?: () => void;
    onToggleMic?: () => void;
    onToggleDeafen?: () => void;
    onLeave?: () => void;
  }>();
</script>

<div class="voice-widget" aria-label="Активный голос">
  <!-- header: room + status -->
  <div class="voice-head">
    <span class="voice-tile" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"></path><rect x="3" y="14" width="4" height="6" rx="1.5"></rect><rect x="17" y="14" width="4" height="6" rx="1.5"></rect></svg>
    </span>
    <div class="voice-head-body">
      <div class="voice-room-name" title={roomName}>{roomName}</div>
      {#if muted}
        <div class="voice-status voice-status--muted">
          <span class="voice-status-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="21" y2="21"></line><path d="M9 9v3a3 3 0 0 0 5.1 2.1"></path><path d="M15 11V5a3 3 0 0 0-5.9-.8"></path><path d="M6 11a6 6 0 0 0 9 5.2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
          </span>
          <span>Микрофон выключен</span>
        </div>
      {:else}
        <div class="voice-status voice-status--live">
          <span class="voice-live-dot"></span>
          <span>Подключено</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- actions -->
  <div class="voice-actions">
    <button class="voice-open" type="button" onclick={onOpen}>Открыть</button>

    <!-- mic toggle -->
    <button
      class="voice-icon-btn"
      class:is-off={muted}
      type="button"
      title={muted ? 'Включить микрофон' : 'Выключить микрофон'}
      aria-pressed={muted}
      onclick={onToggleMic}
    >
      {#if muted}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="21" y2="21"></line><path d="M9 9v3a3 3 0 0 0 5.1 2.1"></path><path d="M15 11V5a3 3 0 0 0-5.9-.8"></path><path d="M6 11a6 6 0 0 0 9 5.2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M6 11a6 6 0 0 0 12 0"></path><line x1="12" y1="17" x2="12" y2="21"></line><line x1="8" y1="21" x2="16" y2="21"></line></svg>
      {/if}
    </button>

    <!-- deafen toggle -->
    <button
      class="voice-icon-btn"
      class:is-off={deafened}
      type="button"
      title={deafened ? 'Включить звук' : 'Заглушить звук'}
      aria-pressed={deafened}
      onclick={onToggleDeafen}
    >
      {#if deafened}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="21" y2="21"></line><path d="M4 14v-2a8 8 0 0 1 12.5-6.6"></path><path d="M20 12v2"></path><rect x="3" y="14" width="4" height="6" rx="1.5"></rect><rect x="17" y="14" width="4" height="6" rx="1.5"></rect></svg>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"></path><rect x="3" y="14" width="4" height="6" rx="1.5"></rect><rect x="17" y="14" width="4" height="6" rx="1.5"></rect></svg>
      {/if}
    </button>

    <!-- leave -->
    <button class="voice-leave" type="button" title="Выйти" aria-label="Выйти из голосовой комнаты" onclick={onLeave}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17l5-5-5-5"></path><path d="M20 12H9"></path><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"></path></svg>
    </button>
  </div>
</div>

<style>
  .voice-widget {
    flex: none;
    margin: 0 12px 10px;
    padding: 14px;
    box-sizing: border-box;
    border-radius: 16px;
    border: 1px solid rgba(79, 174, 116, 0.34);
    background:
      radial-gradient(120% 130% at 0% 0%, rgba(79, 174, 116, 0.16), transparent 60%),
      rgba(79, 174, 116, 0.05);
    box-shadow: 0 0 0 1px rgba(79, 174, 116, 0.06), 0 14px 34px rgba(79, 174, 116, 0.14);
    font-family: var(--font-sans);
  }

  /* header */
  .voice-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }

  .voice-tile {
    flex: none;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: #3f52b8;
    color: #e7ecff;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .voice-head-body {
    flex: 1;
    min-width: 0;
  }

  .voice-room-name {
    font-size: 16px;
    font-weight: 800;
    color: #ece7d9;
    letter-spacing: -0.015em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .voice-status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 11.5px;
    font-weight: 600;
  }

  .voice-status--live { color: #a9c9b6; }
  .voice-status--muted { color: #e0917f; }

  .voice-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4fae74;
  }

  .voice-status-icon {
    display: flex;
    color: #e0917f;
  }

  /* actions */
  .voice-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .voice-open {
    flex: 1;
    height: 40px;
    border: none;
    border-radius: 12px;
    background: #d9d3c3;
    color: #17150f;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .voice-open:hover { background: #e6e0d1; }

  .voice-icon-btn,
  .voice-leave {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .voice-icon-btn {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #e4dece;
  }

  .voice-icon-btn:hover { background: rgba(255, 255, 255, 0.13); }

  .voice-icon-btn.is-off {
    border-color: rgba(216, 99, 74, 0.5);
    background: rgba(216, 99, 74, 0.22);
    color: #e8a094;
  }

  .voice-icon-btn.is-off:hover { background: rgba(216, 99, 74, 0.3); }

  .voice-leave {
    border: none;
    background: rgba(216, 99, 74, 0.92);
    color: #fff;
  }

  .voice-leave:hover { background: #c8543c; }
</style>
