<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { HeadphoneOff, Headphones, Mic, MicOff, PhoneOff } from '@lucide/svelte';
  import { Avatar } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import RoomCallTimer from '$lib/features/room/components/RoomCallTimer.svelte';

  let {
    roomName = '',
    avatarUrl = null,
    muted = false,
    deafened = false,
    onOpen,
    onToggleMic,
    onToggleDeafen,
    onLeave
  } = $props<{
    roomName?: string;
    avatarUrl?: string | null;
    muted?: boolean;
    deafened?: boolean;
    onOpen?: () => void;
    onToggleMic?: () => void;
    onToggleDeafen?: () => void;
    onLeave?: () => void;
  }>();

  const openLabel = $derived(`Открыть комнату ${roomName || 'активного голоса'}`);
</script>

<div class="voice-widget" aria-label="Активный голос">
  <button class="voice-head" type="button" aria-label={openLabel} title={openLabel} onclick={onOpen}>
    <Avatar
      name={roomName}
      src={avatarUrl}
      shape="squircle"
      background="var(--vr-surface-3)"
      foreground="var(--vr-text)"
      size={38}
    />
    <div class="voice-head-body">
      <div class="voice-room-name" title={roomName}><EmojiText text={roomName} /></div>
      <div class="voice-status">
        <span class="voice-live-dot"></span>
        <span class="voice-live-label">Подключено</span>
        <RoomCallTimer variant="sidebar" separator />
      </div>
    </div>
  </button>

  <div class="voice-actions">
    <button
      class="voice-btn"
      class:is-off={muted}
      type="button"
      title={muted ? 'Включить микрофон' : 'Выключить микрофон'}
      aria-label={muted ? 'Включить микрофон' : 'Выключить микрофон'}
      aria-pressed={muted}
      onclick={onToggleMic}
    >
      {#if muted}
        <MicOff {...iconMd} aria-hidden="true" />
      {:else}
        <Mic {...iconMd} aria-hidden="true" />
      {/if}
    </button>

    <button
      class="voice-btn"
      class:is-off={deafened}
      type="button"
      title={deafened ? 'Включить звук' : 'Заглушить звук'}
      aria-label={deafened ? 'Включить звук' : 'Заглушить звук'}
      aria-pressed={deafened}
      onclick={onToggleDeafen}
    >
      {#if deafened}
        <HeadphoneOff {...iconMd} aria-hidden="true" />
      {:else}
        <Headphones {...iconMd} aria-hidden="true" />
      {/if}
    </button>

    <button
      class="voice-btn voice-leave"
      type="button"
      title="Выйти"
      aria-label="Выйти из голосовой комнаты"
      onclick={onLeave}
    >
      <PhoneOff {...iconMd} aria-hidden="true" />
    </button>
  </div>
</div>

<style>
  .voice-widget {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 14px;
    margin: 0 12px 12px;
    padding: 14px;
    box-sizing: border-box;
    border: 1px solid var(--vr-line-strong);
    border-radius: 16px;
    background: var(--vr-surface-2);
    font-family: var(--font-ui);
  }

  .voice-head {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .voice-head:focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: 4px;
  }

  .voice-head-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .voice-room-name {
    overflow: hidden;
    color: var(--vr-text);
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .voice-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
  }

  .voice-live-dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--vr-accent);
    box-shadow: 0 0 0 3px var(--vr-accent-soft);
  }

  .voice-live-label {
    color: var(--vr-accent);
  }

  .voice-actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .voice-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 38px;
    border: none;
    border-radius: 11px;
    background: var(--vr-surface-3);
    color: var(--vr-text);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .voice-btn:hover {
    background: var(--vr-surface-3-hover);
  }

  .voice-btn.is-off {
    background: var(--vr-danger-off);
    color: var(--vr-danger);
  }

  .voice-btn.is-off:hover {
    background: var(--vr-danger-soft);
  }

  .voice-btn:focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: 2px;
  }

  .voice-leave,
  .voice-leave:hover {
    background: var(--vr-danger);
    color: var(--vr-on-danger);
  }

  .voice-leave:hover {
    background: color-mix(in oklch, var(--vr-danger), var(--vr-on-danger) 12%);
  }
</style>
