<script lang="ts">
  import { Music, Square, SkipForward, Volume2, VolumeX, X } from '@lucide/svelte';
  import { iconSm, iconXs } from '$lib/shared/ui/icons';
  import { Slider } from '$lib/shared/ui';
  import { MAX_MUSIC_VOLUME } from '../client/core/config';
  import { getParticipantById } from '../client/room/participants';
  import { state as roomClientState } from '../client/core/state.svelte';
  import {
    canControlMusicItem,
    closeRoomMusicPanel,
    isMusicPositionAuthoritative,
    isRoomMusicMaster,
    isRoomMusicVisible,
    MUSIC_LINK_HINT,
    musicPreferences,
    removeRoomMusicQueueItem,
    roomMusic,
    setRoomMusicVolume,
    skipRoomMusicItem,
    stopRoomMusicPlayback,
    submitRoomMusicLink,
    toggleRoomMusicMuted
  } from '../room-music.svelte';

  // The player exists only in a static room. This is presentation, not
  // authorization: every command is checked again on the server, which rejects
  // a non-static room with `room_not_static` and a non-author with `forbidden`.
  const visible = $derived(isRoomMusicVisible());
  const session = $derived(roomMusic.session);
  const currentItem = $derived(session.currentItem);
  const isMaster = $derived(isRoomMusicMaster());
  const positionAuthoritative = $derived(isMusicPositionAuthoritative());
  const unavailable = $derived(session.status === 'unavailable');

  function authorName(peerId: string): string {
    if (peerId === roomClientState.peerId) return 'вы';
    return getParticipantById(peerId)?.name || 'участник';
  }

  function formatTime(ms: number | null | undefined): string {
    if (!Number.isFinite(ms) || (ms as number) < 0) return '--:--';
    const totalSeconds = Math.floor((ms as number) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    submitRoomMusicLink();
  }
</script>

<div
  class="room-music-panel"
  role="dialog"
  aria-label="Музыка комнаты"
  hidden={!visible || !roomMusic.panelOpen}
>
  <div class="room-music-head">
    <span class="room-music-head-icon" aria-hidden="true"><Music {...iconSm} /></span>
    <h2 class="room-music-title">Музыка</h2>
    <button class="room-music-close" type="button" aria-label="Закрыть музыку" onclick={closeRoomMusicPanel}>
      <X {...iconSm} aria-hidden="true" />
    </button>
  </div>

  {#if unavailable}
    <p class="room-music-status" role="status">Музыка сейчас недоступна.</p>
  {/if}

  <form class="room-music-form" onsubmit={handleSubmit}>
    <label class="sr-only" for="roomMusicLinkInput">{MUSIC_LINK_HINT}</label>
    <input
      id="roomMusicLinkInput"
      class="room-music-input"
      type="url"
      inputmode="url"
      autocomplete="off"
      placeholder="Ссылка на VK Видео, Rutube или YouTube"
      bind:value={roomMusic.linkInput}
      oninput={() => { roomMusic.error = ''; }}
    />
    <button class="room-music-add" type="submit" disabled={!roomMusic.linkInput.trim()}>Добавить</button>
  </form>
  {#if roomMusic.error}
    <p class="room-music-error" role="alert">{roomMusic.error}</p>
  {/if}

  <section class="room-music-current" aria-label="Сейчас играет">
    {#if currentItem}
      <div class="room-music-current-body">
        {#if currentItem.coverUrl}
          <img class="room-music-cover" src={currentItem.coverUrl} alt="" />
        {:else}
          <span class="room-music-cover room-music-cover-empty" aria-hidden="true"><Music {...iconSm} /></span>
        {/if}
        <div class="room-music-current-text">
          <span class="room-music-track">{currentItem.title || 'Без названия'}</span>
          <span class="room-music-artist">{currentItem.artist || 'Неизвестный исполнитель'}</span>
          <span class="room-music-meta">
            <!-- The position comes from the bot heartbeat. When the last one is
                 older than the contract's staleness window the progress is shown
                 as an estimate rather than as fact. -->
            <span class="room-music-position" data-stale={!positionAuthoritative}>
              {formatTime(session.positionMs)} / {formatTime(currentItem.durationMs)}
            </span>
            {#if !positionAuthoritative}
              <span class="room-music-stale">приблизительно</span>
            {/if}
            <span class="room-music-author">добавил(а) {authorName(currentItem.addedBy)}</span>
          </span>
        </div>
        <div class="room-music-current-actions">
          {#if canControlMusicItem(currentItem)}
            <button
              class="room-music-action"
              type="button"
              aria-label="Пропустить трек"
              onclick={() => skipRoomMusicItem(null)}
            >
              <SkipForward {...iconSm} aria-hidden="true" />
            </button>
          {/if}
          {#if isMaster}
            <button
              class="room-music-action"
              type="button"
              aria-label="Остановить музыку"
              onclick={() => stopRoomMusicPlayback()}
            >
              <Square {...iconSm} aria-hidden="true" />
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <p class="room-music-empty">
        {session.status === 'resolving' ? 'Загружаем трек…' : 'Ничего не играет.'}
      </p>
    {/if}
  </section>

  <section class="room-music-queue" aria-label="Очередь">
    {#if session.queue.length === 0}
      <p class="room-music-empty">Очередь пуста.</p>
    {:else}
      <ul class="room-music-queue-list">
        {#each session.queue as item (item.id)}
          <li class="room-music-queue-item">
            <span class="room-music-queue-text">
              <span class="room-music-track">{item.title || 'Без названия'}</span>
              <span class="room-music-artist">{item.artist || 'Неизвестный исполнитель'}</span>
              <span class="room-music-author">добавил(а) {authorName(item.addedBy)}</span>
            </span>
            {#if canControlMusicItem(item)}
              <button
                class="room-music-action"
                type="button"
                aria-label={`Убрать «${item.title || 'трек'}» из очереди`}
                onclick={() => removeRoomMusicQueueItem(item.id)}
              >
                <X {...iconXs} aria-hidden="true" />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Local only: neither control produces an outgoing message, and neither
       touches the subscription — both are gain on the 'media' bus. -->
  <section class="room-music-volume" aria-label="Локальная громкость музыки">
    <button
      class="room-music-action"
      type="button"
      role="switch"
      aria-checked={musicPreferences.muted}
      aria-label={musicPreferences.muted ? 'Включить музыку для себя' : 'Выключить музыку для себя'}
      onclick={toggleRoomMusicMuted}
    >
      {#if musicPreferences.muted}
        <VolumeX {...iconSm} aria-hidden="true" />
      {:else}
        <Volume2 {...iconSm} aria-hidden="true" />
      {/if}
    </button>
    <Slider
      value={musicPreferences.volume}
      min={0}
      max={MAX_MUSIC_VOLUME}
      step={0.05}
      defaultValue={0.5}
      ariaLabel="Громкость музыки"
      ariaValueText={`${Math.round(musicPreferences.volume * 100)}%`}
      onValueChange={setRoomMusicVolume}
    />
    <output class="room-music-volume-value">{Math.round(musicPreferences.volume * 100)}%</output>
  </section>
</div>

<style>
  .room-music-panel {
    position: fixed;
    right: 18px;
    bottom: 92px;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(360px, calc(100vw - 36px));
    max-height: min(520px, calc(100vh - 160px));
    padding: 14px;
    overflow-y: auto;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    background: color-mix(in oklch, var(--control), transparent 8%);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
    font-family: var(--font-ui);
    color: var(--warm-ink);
  }

  .room-music-panel[hidden] {
    display: none;
  }

  .room-music-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .room-music-head-icon {
    display: inline-flex;
    color: var(--accent);
  }

  .room-music-title {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }

  .room-music-close,
  .room-music-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--warm-muted);
    cursor: pointer;
  }

  .room-music-close:hover,
  .room-music-action:hover {
    background: color-mix(in oklch, var(--panel-strong), transparent 35%);
    color: var(--warm-ink);
  }

  .room-music-form {
    display: flex;
    gap: 8px;
  }

  .room-music-input {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    background: color-mix(in oklch, var(--paper-deep), transparent 15%);
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 13px;
  }

  .room-music-add {
    flex: none;
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: var(--accent);
    color: #17150f;
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .room-music-add:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .room-music-error {
    margin: 0;
    color: var(--danger, #e2725b);
    font-size: 12px;
  }

  .room-music-status {
    margin: 0;
    color: var(--warm-muted);
    font-size: 12.5px;
  }

  .room-music-current-body {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .room-music-cover {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    object-fit: cover;
    background: color-mix(in oklch, var(--control), transparent 45%);
  }

  .room-music-cover-empty {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--warm-faint);
  }

  .room-music-current-text,
  .room-music-queue-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .room-music-current-actions {
    display: flex;
    flex: none;
    gap: 2px;
  }

  .room-music-track {
    overflow: hidden;
    font-size: 13px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .room-music-artist {
    overflow: hidden;
    color: var(--warm-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .room-music-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
  }

  .room-music-position {
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .room-music-position[data-stale='true'] {
    opacity: 0.65;
  }

  .room-music-stale,
  .room-music-author {
    color: var(--warm-faint);
    font-size: 11.5px;
  }

  .room-music-empty {
    margin: 0;
    color: var(--warm-faint);
    font-size: 12.5px;
  }

  .room-music-queue-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .room-music-queue-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .room-music-volume {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .room-music-volume-value {
    flex: none;
    min-width: 38px;
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 11.5px;
    text-align: right;
  }
</style>
