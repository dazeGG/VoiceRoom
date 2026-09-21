<script lang="ts">
  import { onMount } from 'svelte';
  import HomePage from '$lib/features/home/HomePage.svelte';
  import MobileStartScreen from '$lib/features/home/components/MobileStartScreen.svelte';
  import { dismissToast, pushToast, toastState } from '$lib/features/home/model/toasts.svelte';
  import { applyDesktopBoundaryToDocument } from '$lib/platform/desktop-boundary';
  import { ToastStack } from '$lib/shared/ui';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';

  let boundaryReady = $state(false);
  let desktopAllowed = $state(false);
  // A phone cannot run the lobby, but it can run a room, so `/` offers to start
  // one instead of turning the visitor away.
  let roomClientAllowed = $state(false);

  onMount(() => {
    const policy = applyDesktopBoundaryToDocument();
    desktopAllowed = policy.desktopAllowed;
    roomClientAllowed = policy.roomClientAllowed;
    boundaryReady = true;
  });
</script>

<svelte:head>
  <title>Voice Room</title>
  <meta name="theme-color" content="#10110f">
</svelte:head>

{#if !boundaryReady}
  <div class="app-shell">
    <main class="auth-loader" aria-label="Проверка устройства" aria-busy="true">
      <div class="auth-loader-card">
        <p class="auth-loader-kicker">Проверяем устройство</p>
        <h1>Voice Room запускается</h1>
      </div>
    </main>
  </div>
{:else if desktopAllowed}
  <HomePage />
{:else if roomClientAllowed}
  <MobileStartScreen onToast={(message) => pushToast(message)} />
  <ToastStack toasts={toastState.items} onDismiss={dismissToast} />
{:else}
  <div class="app-shell">
    <main class="auth-session-error" aria-label="Неподдерживаемое устройство" aria-live="polite">
      <div class="auth-session-error-card">
        <p class="auth-loader-kicker">Desktop only</p>
        <h1>Откройте Voice Room на компьютере</h1>
        <p>Мобильные браузеры не запускают этот клиент: realtime, голос, медиа и push-уведомления здесь отключены.</p>
      </div>
    </main>
  </div>
{/if}
