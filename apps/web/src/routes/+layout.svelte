<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { page, updated } from '$app/state';
  import { AppUpdate } from '$lib/features/app-update/app-update.svelte';
  import AppUpdateNotice from '$lib/features/app-update/AppUpdateNotice.svelte';
  import { callActivity } from '$lib/shared/call-activity.svelte';
  import { applyDesktopBoundaryToDocument } from '$lib/platform/desktop-boundary';
  import { bindDesktopSystem } from '$lib/platform/desktop-system';
  import { isMobileRoute } from '$lib/platform/mobile-routes';
  import { installEmojiCopy } from '$lib/shared/chat/emoji-copy';
  import { initTheme } from '$lib/shared/theme/theme.svelte';

  let { children } = $props();
  let boundaryReady = $state(false);
  let desktopAllowed = $state(false);
  let roomClientAllowed = $state(false);
  // Phones get only the routes in mobile-routes.ts; the rest keep the block
  // screen below.
  const allowed = $derived(desktopAllowed || (roomClientAllowed && isMobileRoute(page.route.id)));

  // A new deploy (SvelteKit's version check) or a downloaded desktop shell.
  const appUpdate = new AppUpdate({ webUpdated: () => updated.current });

  // Once a new web app is out, the next move inside the app loads it as a
  // full page, so it arrives without a separate reload; never during a call.
  beforeNavigate(({ willUnload, to }) => {
    if (updated.current && !willUnload && to?.url && !callActivity.active) {
      window.location.href = to.url.href;
    }
  });

  function checkForUpdate(): void {
    void updated.check().catch(() => {});
  }

  onMount(() => {
    initTheme();
    const policy = applyDesktopBoundaryToDocument();
    desktopAllowed = policy.desktopAllowed;
    roomClientAllowed = policy.roomClientAllowed;
    boundaryReady = true;
    // Game mode and wake-ups from the desktop app; nothing in a browser.
    // The realtime module loads lazily: pages without a socket never need it.
    const unbindDesktopSystem = bindDesktopSystem({
      onWake: () => void import('$lib/api/realtime').then((realtime) => realtime.getAppRealtime().probeLiveness())
    });
    // Emoji drawn as artwork copy as their characters anywhere in the app.
    const removeEmojiCopy = installEmojiCopy();
    const unbindAppUpdate = appUpdate.bind();
    // Besides SvelteKit's periodic poll, look for a new version when the tab
    // comes back into view and after the realtime socket reconnects: a deploy
    // restarts the server, so a reconnect is when a new version is likely.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    let stopRestore: (() => void) | null = null;
    let unmounted = false;
    void import('$lib/api/realtime').then((realtime) => {
      if (!unmounted) stopRestore = realtime.getAppRealtime().onRestore(checkForUpdate);
    });
    return () => {
      unmounted = true;
      unbindDesktopSystem();
      removeEmojiCopy();
      unbindAppUpdate();
      document.removeEventListener('visibilitychange', onVisibility);
      stopRestore?.();
    };
  });
</script>

{#if !boundaryReady}
  <main class="device-boundary" aria-label="Проверка устройства" aria-busy="true">
    <section class="device-boundary__card">
      <p>Проверяем устройство</p>
      <h1>Voice Room запускается</h1>
    </section>
  </main>
{:else if allowed}
  {@render children()}
  <AppUpdateNotice update={appUpdate} inCall={callActivity.active} />
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
    color: var(--vr-text);
    background: var(--vr-bg);
    font-family: var(--font-ui);
  }

  .device-boundary__card {
    box-sizing: border-box;
    width: min(100%, 520px);
    padding: clamp(24px, 7vw, 48px);
    border: 1px solid var(--vr-line-strong);
    border-radius: 24px;
    background: var(--vr-surface);
  }

  .device-boundary__card h1 {
    margin: 8px 0 16px;
    font-size: clamp(28px, 8vw, 48px);
    line-height: 1.05;
  }

  .device-boundary__card p {
    margin: 0;
    color: var(--vr-text-2);
    line-height: 1.5;
  }
</style>
