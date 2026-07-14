<script lang="ts">
  import { voiceSession } from '../voice-session.svelte';

  let { variant = 'topbar' } = $props<{ variant?: 'sidebar' | 'topbar' }>();

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

  const elapsed = $derived(formatElapsed(voiceSession.roomActiveSince));
</script>

{#if elapsed}
  <span
    class="room-call-timer room-call-timer--{variant}"
    title="Длительность звонка в комнате"
    aria-label={`Длительность звонка ${elapsed}`}
  >{elapsed}</span>
{/if}

<style>
  .room-call-timer {
    display: inline-flex;
    align-items: center;
    flex: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }

  .room-call-timer--sidebar {
    font-size: 14px;
  }

  .room-call-timer--topbar {
    font-size: 15px;
  }
</style>
