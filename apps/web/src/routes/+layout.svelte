<script lang="ts">
  import { onMount } from 'svelte';
  import { applyDesktopBoundaryToDocument } from '$lib/platform/desktop-boundary';

  let { children } = $props();
  let boundaryReady = $state(false);
  let desktopAllowed = $state(false);

  onMount(() => {
    desktopAllowed = applyDesktopBoundaryToDocument().desktopAllowed;
    boundaryReady = true;
  });
</script>

{#if !boundaryReady}
  <main class="device-boundary" aria-label="Проверка устройства" aria-busy="true">
    <section class="device-boundary__card">
      <p>Проверяем устройство</p>
      <h1>Voice Room запускается</h1>
    </section>
  </main>
{:else if desktopAllowed}
  {@render children()}
{:else}
  <main class="device-boundary" aria-label="Неподдерживаемое устройство" aria-live="polite">
    <section class="device-boundary__card">
      <p>Desktop only</p>
      <h1>Откройте Voice Room на компьютере</h1>
      <p>Мобильный клиент не запускает сессию, realtime, голос, медиа или push-уведомления.</p>
    </section>
  </main>
{/if}

<style>
  .device-boundary {
    box-sizing: border-box;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px;
    color: var(--ink);
    background: var(--paper-deep);
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }

  .device-boundary__card {
    box-sizing: border-box;
    width: min(100%, 520px);
    padding: clamp(24px, 7vw, 48px);
    border: 1px solid var(--line);
    border-radius: 24px;
    background: var(--panel);
  }

  .device-boundary__card h1 {
    margin: 8px 0 16px;
    font-size: clamp(28px, 8vw, 48px);
    line-height: 1.05;
  }

  .device-boundary__card p {
    margin: 0;
    color: var(--muted);
    line-height: 1.5;
  }
</style>
