<script lang="ts">
  import { LayoutGrid, MessageSquare, Users } from '@lucide/svelte';
  import { Avatar } from '$lib/shared/ui';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { getParticipantCount } from '../participants-ui.svelte';
  import { getRoomUnreadCount, isRoomPanelOpen, toggleRoomPanel } from '../room-panel-toggle.svelte';
  import { voiceSession } from '../voice-session.svelte';
  import { mobileCallUi, toggleMobileCallView } from '../mobile-call-ui.svelte';
  import RoomCallTimer from './RoomCallTimer.svelte';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { showToast } from '../client/ui/toast';

  let { duo }: { duo: boolean } = $props();

  const heading = $derived(roomClientState.roomName || roomClientState.roomId);
  const unread = $derived(getRoomUnreadCount());
  const viewLabel = $derived(mobileCallUi.view === 'grid' ? 'Фокус на говорящем' : 'Сетка');

  // A phone shares the room through its own sheet (messengers, AirDrop); where
  // there is none the link goes to the clipboard.
  async function invite(): Promise<void> {
    const url = `${window.location.origin}/r/${encodeURIComponent(roomClientState.roomId)}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: heading, url });
        return;
      } catch (error) {
        // Closing the sheet is a choice, not a failure.
        if ((error as { name?: string } | null)?.name === 'AbortError') return;
      }
    }
    try {
      await copyText(url);
      showToast('Ссылка скопирована');
    } catch {
      showToast('Не удалось скопировать');
    }
  }
</script>

<header class="mc-topbar" data-duo={duo ? 'true' : undefined}>
  <button class="mc-topbar-room" type="button" aria-label={`Пригласить в «${heading}»`} onclick={() => void invite()}>
    <Avatar
      name={heading}
      src={roomClientState.roomAvatarUrl || null}
      shape="squircle"
      background="var(--vr-surface-3)"
      size={36}
    />
    <span class="mc-topbar-copy">
      <span class="mc-topbar-title">{heading}</span>
      <span class="mc-topbar-meta">
        <RoomCallTimer />
        {#if voiceSession.roomActiveSince}<span class="mc-topbar-dot" aria-hidden="true">·</span>{/if}
        <span>{getParticipantCount()} в звонке</span>
      </span>
    </span>
  </button>
  <div class="room-panel-tabs mc-topbar-actions" role="group" aria-label="Звонок">
    {#if !duo}
      <button
        type="button"
        class="mc-topbar-view"
        aria-label={viewLabel}
        title={viewLabel}
        onclick={toggleMobileCallView}
      >
        {#if mobileCallUi.view === 'grid'}
          <!-- One big frame over three small ones: the focus layout. -->
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="15" height="9.5" rx="2" stroke="currentColor" stroke-width="1.6" />
            <rect x="1.5" y="13" width="4" height="3.5" rx="1" fill="currentColor" />
            <rect x="7" y="13" width="4" height="3.5" rx="1" fill="currentColor" />
            <rect x="12.5" y="13" width="4" height="3.5" rx="1" fill="currentColor" />
          </svg>
        {:else}
          <LayoutGrid size={18} aria-hidden="true" />
        {/if}
      </button>
    {/if}
    <button
      type="button"
      aria-label="Чат"
      aria-pressed={isRoomPanelOpen('chat')}
      data-active={isRoomPanelOpen('chat')}
      onclick={() => toggleRoomPanel('chat')}
    >
      <MessageSquare size={18} aria-hidden="true" />
      {#if unread > 0}<span class="room-panel-tab-unread" aria-hidden="true"></span>{/if}
    </button>
    <button
      type="button"
      aria-label="Участники"
      aria-pressed={isRoomPanelOpen('participants')}
      data-active={isRoomPanelOpen('participants')}
      onclick={() => toggleRoomPanel('participants')}
    >
      <Users size={18} aria-hidden="true" />
    </button>
  </div>
</header>

<style>
  .mc-topbar {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 10px;
    height: calc(var(--mc-safe-top) + 56px);
    padding: var(--mc-safe-top) 10px 0 14px;
    box-sizing: border-box;
    background: color-mix(in oklch, var(--vr-bg) 94%, transparent);
    transition:
      opacity 250ms ease,
      transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  /* Two people: the picture runs under the bar, so it only darkens the top. */
  .mc-topbar[data-duo='true'] {
    align-items: flex-start;
    height: calc(var(--mc-safe-top) + 96px);
    padding-top: calc(var(--mc-safe-top) + 10px);
    background: linear-gradient(
      180deg,
      var(--vr-scrim) 0%,
      color-mix(in oklch, var(--vr-scrim) 64%, transparent) 55%,
      transparent 100%
    );
    pointer-events: none;
  }

  .mc-topbar[data-duo='true'] > :global(*) {
    pointer-events: auto;
  }

  :global(.mobile-call[data-chrome='hidden']) .mc-topbar {
    opacity: 0;
    transform: translateY(-16px);
    pointer-events: none;
  }

  :global(.mobile-call[data-chrome='hidden']) .mc-topbar > :global(*) {
    pointer-events: none;
  }

  .mc-topbar-room {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
  }

  .mc-topbar-copy {
    display: grid;
    flex: 1 1 auto;
    min-width: 0;
    gap: 3px;
  }

  .mc-topbar-title {
    margin: 0;
    overflow: hidden;
    color: var(--vr-text);
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mc-topbar-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--vr-text-2);
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
  }

  .mc-topbar-meta :global(.room-call-timer--topbar) {
    font-size: 12px;
  }

  .mc-topbar-dot {
    color: var(--vr-text-3);
  }

  .mc-topbar-actions {
    flex: none;
  }

  .mc-topbar-actions button {
    width: 40px;
    height: 40px;
  }

  .mc-topbar-view {
    color: var(--vr-text);
  }
</style>
