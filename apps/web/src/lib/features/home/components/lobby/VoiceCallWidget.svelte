<script lang="ts">
  import { HeadphoneOff, Headphones, LogOut, Mic, MicOff } from '@lucide/svelte';
  import { Avatar } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { voiceSession } from '$lib/features/room/voice-session.svelte';

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

  // Both timers derive from server timestamps and a shared 1s tick.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  function formatElapsed(since: number | null): string {
    if (!since) return '';
    const total = Math.max(0, Math.floor((now - since) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
    const ss = String(seconds).padStart(2, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  const roomElapsed = $derived(formatElapsed(voiceSession.roomActiveSince));
</script>

<div class="voice-widget" aria-label="Активный голос">
  <!-- header: room + status -->
  <button class="voice-head" type="button" aria-label={openLabel} title={openLabel} onclick={onOpen}>
    <Avatar name={roomName} src={avatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={42} />
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
    {#if roomElapsed}
      <div class="voice-timers" aria-label="Длительность звонка">
        <span class="voice-timer" title="Длительность звонка в комнате">
          <span class="voice-timer-label">звонок</span>
          <span class="voice-timer-value">{roomElapsed}</span>
        </span>
      </div>
    {/if}

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
    font-family: var(--font-ui);
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

  /* connection timers fill the empty bottom-left corner */
  .voice-timers {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    align-self: center;
  }

  .voice-timer {
    display: flex;
    align-items: baseline;
    gap: 6px;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
  }

  .voice-timer-label {
    min-width: 0;
    overflow: hidden;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-overflow: ellipsis;
    text-transform: uppercase;
  }

  .voice-timer-value {
    font-size: 14px;
    letter-spacing: 0.01em;
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
    background: var(--control);
    color: var(--warm-ink-dim);
  }

  .voice-icon-btn:hover { background: var(--control-hover); }

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

  .voice-leave:hover { background: color-mix(in oklch, var(--coral), var(--warm-950) 12%); }
</style>
