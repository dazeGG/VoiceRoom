<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { logout } from '$lib/api/auth';
  import { clearSession, loadSession, session } from '$lib/features/auth/session.svelte';
  import LobbyPage from '$lib/features/home/LobbyPage.svelte';
  import Toast from '$lib/features/home/components/Toast.svelte';
  import '$lib/features/home/styles/home.css';
  import RoomPage from '$lib/features/room/RoomPage.svelte';

  let loggingOut = $state(false);
  let authLoadError = $state(false);
  let toast = $state('');
  let toastTimer = 0;
  const routeRoomId = $derived(page.params.roomId || '');

  onMount(() => {
    void loadSession().catch(() => {
      authLoadError = true;
    });

    return () => {
      window.clearTimeout(toastTimer);
    };
  });

  function showToast(message: string): void {
    toast = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = '';
    }, 2600);
  }

  function retrySessionLoad(): void {
    if (!session.loaded) return;
    authLoadError = false;
    session.loaded = false;
    void loadSession(true).catch(() => {
      authLoadError = true;
    });
  }

  async function handleLogout(): Promise<void> {
    if (loggingOut) return;
    loggingOut = true;
    try {
      await logout();
      clearSession();
      showToast('Вы вышли из аккаунта');
    } catch (error) {
      showToast(error instanceof Error && error.message ? error.message : 'Не удалось выйти');
    } finally {
      loggingOut = false;
    }
  }
</script>

<svelte:head>
  <title>Voice Room</title>
  <meta name="theme-color" content="#10110f">
</svelte:head>

{#if !session.loaded}
  <div class="app-shell">
    <main class="auth-loader" aria-label="Загрузка аккаунта" aria-busy="true">
      <div class="auth-loader-card">
        <span class="auth-loader-orb" aria-hidden="true"></span>
        <p class="auth-loader-kicker">Проверяем сессию</p>
        <h1>Открываем комнату</h1>
      </div>
    </main>
  </div>
{:else if authLoadError}
  <div class="app-shell">
    <main class="auth-session-error" aria-label="Ошибка проверки аккаунта" aria-live="polite">
      <div class="auth-session-error-card">
        <p class="auth-loader-kicker">Сессия не проверена</p>
        <h1>Не удалось проверить аккаунт</h1>
        <p>Проверьте подключение к серверу и повторите попытку. Мы не будем открывать комнату как гостевую, пока проверка не пройдет.</p>
        <button class="home-primary-button" type="button" onclick={retrySessionLoad}>Повторить</button>
      </div>
    </main>
  </div>
{:else if session.user}
  <LobbyPage user={session.user} {loggingOut} onLogout={handleLogout} onToast={showToast} />
{:else}
  {#key routeRoomId}
    <RoomPage roomId={routeRoomId} />
  {/key}
{/if}

<Toast message={toast} />
