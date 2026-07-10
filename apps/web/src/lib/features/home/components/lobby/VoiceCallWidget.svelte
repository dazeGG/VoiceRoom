<script lang="ts">
  import { HeadphoneOff, Headphones, LogOut, Mic, MicOff } from '@lucide/svelte';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { getRoomPreset, type RoomPresetToken } from '$lib/visual/tokens';

  let {
    roomName = '',
    roomVisual = null,
    muted = false,
    deafened = false,
    onOpen,
    onToggleMic,
    onToggleDeafen,
    onLeave
  } = $props<{
    roomName?: string;
    roomVisual?: RoomPresetToken | null;
    muted?: boolean;
    deafened?: boolean;
    onOpen?: () => void;
    onToggleMic?: () => void;
    onToggleDeafen?: () => void;
    onLeave?: () => void;
  }>();

  const visual = $derived(roomVisual ?? getRoomPreset(null));
  const openLabel = $derived(`Открыть комнату ${roomName || 'активного голоса'}`);
</script>

<div class="voice-widget" aria-label="Активный голос">
  <!-- header: room + status -->
  <button class="voice-head" type="button" aria-label={openLabel} title={openLabel} onclick={onOpen}>
    <span
      class="voice-tile"
      style={`background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`}
      aria-hidden="true"
    >{visual.emoji}</span>
    <div class="voice-head-body">
      <div class="voice-room-name" title={roomName}>{roomName}</div>
      {#if muted}
        <div class="voice-status voice-status--muted">
          <span class="voice-status-icon">
            <MicOff {...iconSm} aria-hidden="true" />
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
  </button>

  <!-- actions -->
  <div class="voice-actions">
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
        <MicOff {...iconMd} aria-hidden="true" />
      {:else}
        <Mic {...iconMd} aria-hidden="true" />
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
        <HeadphoneOff {...iconMd} aria-hidden="true" />
      {:else}
        <Headphones {...iconMd} aria-hidden="true" />
      {/if}
    </button>

    <!-- leave -->
    <button class="voice-leave" type="button" title="Выйти" aria-label="Выйти из голосовой комнаты" onclick={onLeave}>
      <LogOut {...iconMd} aria-hidden="true" />
    </button>
  </div>
</div>

<style>
  .voice-widget {
    flex: none;
    margin: 0 12px 10px;
    padding: 14px;
    box-sizing: border-box;
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in oklch, var(--green), transparent 66%);
    background:
      radial-gradient(120% 130% at 0% 0%, color-mix(in oklch, var(--green), transparent 84%), transparent 60%),
      color-mix(in oklch, var(--green), transparent 95%);
    box-shadow: 0 0 0 1px color-mix(in oklch, var(--green), transparent 94%), 0 14px 34px color-mix(in oklch, var(--green), transparent 86%);
    font-family: var(--font-sans);
  }

  /* header */
  .voice-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 0 14px;
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .voice-head:hover .voice-room-name { color: var(--accent); }

  .voice-head:focus-visible {
    outline: 2px solid color-mix(in oklch, var(--accent), transparent 20%);
    outline-offset: 4px;
  }

  .voice-tile {
    flex: none;
    width: 42px;
    height: 42px;
    border-radius: var(--radius-md);
    color: var(--accent-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    line-height: 1;
  }

  .voice-head-body {
    flex: 1;
    min-width: 0;
  }

  .voice-room-name {
    font-size: 16px;
    font-weight: 800;
    color: var(--warm-ink);
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

  .voice-status--live { color: var(--green); }
  .voice-status--muted { color: var(--coral); }

  .voice-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
  }

  .voice-status-icon {
    display: flex;
    color: var(--coral);
  }

  /* actions */
  .voice-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .voice-icon-btn,
  .voice-leave {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .voice-icon-btn {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: var(--warm-ink-dim);
  }

  .voice-icon-btn:hover { background: rgba(255, 255, 255, 0.13); }

  .voice-icon-btn.is-off {
    border-color: color-mix(in oklch, var(--coral), transparent 50%);
    background: color-mix(in oklch, var(--coral), transparent 78%);
    color: var(--coral);
  }

  .voice-icon-btn.is-off:hover { background: color-mix(in oklch, var(--coral), transparent 70%); }

  .voice-leave {
    border: none;
    background: var(--coral);
    color: #fff;
  }

  .voice-leave:hover { background: color-mix(in oklch, var(--coral), black 12%); }
</style>