<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowRight } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { createRoom } from '$lib/api/rooms';
  import type { AuthUser } from '$lib/api/auth';
  import { loadSession, session, setUser } from '$lib/features/auth/session.svelte';
  import { signOut } from './model/sign-out';
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';
  import './styles/home.css';
  import { extractRoomId } from '$lib/shared/utils/room';
  import { markInAppRoomNavigation } from '$lib/platform/open-in-app';
  import { MascotIcon, ToastStack } from '$lib/shared/ui';
  import DesktopAppCard from './components/DesktopAppCard.svelte';
  import LandingHero from './components/LandingHero.svelte';
  import LegalLinks from '$lib/shared/components/LegalLinks.svelte';
  import AuthDialog from '$lib/features/auth/AuthDialog.svelte';
  import type { AuthMode } from '$lib/features/auth/auth-mode';
  import LobbyPage from './LobbyPage.svelte';
  import PermanentRoomOfferDialog from './components/PermanentRoomOfferDialog.svelte';
  import {
    dismissPermanentRoomOffer,
    rememberGuestRoomCreated,
    shouldOfferPermanentRoom
  } from './model/returning-guest';
  import { dismissToast, pushToast, toastState, type ToastOptions } from './model/toasts.svelte';
  import { syncPushNotificationState } from './model/push-notifications.svelte';

  let { initialAuthMode = null }: { initialAuthMode?: AuthMode | null } = $props();

  let roomCode = $state('');
  let creatingTemp = $state(false);
  let joining = $state(false);
  let loggingOut = $state(false);
  let authLoadError = $state(false);
  let permanentRoomOfferOpen = $state(false);
  // The sign-in dialog opened from the offer; it is not the one in the URL,
  // because it ends in the lobby's new-room dialog, not on the bare lobby.
  let offerAuthMode = $state<AuthMode | null>(null);
  let createRoomInLobby = $state(false);

  const user = $derived(session.user);
  const authMode = $derived.by<AuthMode | null>(() => {
    const requestedMode = page.url.searchParams.get('auth');
    if (requestedMode === 'login' || requestedMode === 'register' || requestedMode === 'recover') return requestedMode;
    return initialAuthMode;
  });

  $effect(() => {
    void syncPushNotificationState(user?.id ?? null);
  });

  // The new-room dialog greets only the sign-in made from the offer; after a
  // sign-out the page stays, and a later plain sign-in opens the bare lobby.
  $effect(() => {
    if (!user) createRoomInLobby = false;
  });

  onMount(() => {
    document.body.dataset.screen = 'start';
    void loadSession().catch(() => {
      authLoadError = true;
    });
    return () => {
      delete document.body.dataset.screen;
    };
  });

  function retrySessionLoad(): void {
    if (!session.loaded) return;
    authLoadError = false;
    session.loaded = false;
    void loadSession(true).catch(() => {
      authLoadError = true;
    });
  }

  function handleCreateTemp(): void {
    if (creatingTemp) return;
    if (shouldOfferPermanentRoom()) {
      permanentRoomOfferOpen = true;
      return;
    }
    void createTempRoom();
  }

  function continueAsGuest(): void {
    permanentRoomOfferOpen = false;
    dismissPermanentRoomOffer();
    void createTempRoom();
  }

  function registerFromOffer(): void {
    permanentRoomOfferOpen = false;
    offerAuthMode = 'register';
  }

  // The account came for a room whose link stays, so the lobby opens with the
  // new-room dialog, permanent by default.
  function afterOfferAuthenticated(account: AuthUser): void {
    offerAuthMode = null;
    createRoomInLobby = true;
    setUser(account);
  }

  async function createTempRoom(): Promise<void> {
    if (creatingTemp) return;
    creatingTemp = true;
    try {
      const roomId = await createRoom({ isStatic: false });
      rememberGuestRoomCreated();
      openRoom(roomId);
    } catch (error) {
      creatingTemp = false;
      showToast(error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
    }
  }

  function handleJoinRoom(): void {
    if (joining) return;
    const roomId = extractRoomId(roomCode);
    if (!roomId) {
      showToast('Введите код комнаты');
      return;
    }
    joining = true;
    openRoom(roomId);
  }

  function handleRoomCodeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleJoinRoom();
  }

  async function handleLogout(): Promise<void> {
    if (loggingOut) return;
    loggingOut = true;
    try {
      await signOut();
      showToast('Вы вышли из аккаунта');
    } catch (error) {
      showToast(error instanceof Error && error.message ? error.message : 'Не удалось выйти из аккаунта');
    } finally {
      loggingOut = false;
    }
  }

  function openRoom(roomId: string): void {
    markInAppRoomNavigation();
    window.location.href = `/r/${encodeURIComponent(roomId)}`;
  }

  function showToast(message: string, options?: ToastOptions): void {
    pushToast(message, options);
  }

  function closeAuthDialog(): void {
    void goto(resolve('/'), { replaceState: true, noScroll: true });
  }

  function switchAuthMode(mode: AuthMode): void {
    void goto(`/?auth=${mode}`, { replaceState: true, noScroll: true });
  }
</script>

{#if !session.loaded}
  <div class="app-shell">
    <Topbar label="VoiceRoom" />
    <main class="auth-loader" aria-label="Загрузка аккаунта" aria-busy="true">
      <div class="auth-loader-card">
        <span class="auth-loader-orb"><MascotIcon variant="blink" size={52} /></span>
        <p class="auth-loader-kicker">Проверяем сессию</p>
        <h1>Готовим ваши комнаты</h1>
        <div class="auth-loader-lines" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      </div>
    </main>
  </div>
{:else if authLoadError}
  <div class="app-shell">
    <Topbar label="VoiceRoom" />
    <main class="auth-session-error" aria-label="Ошибка проверки аккаунта" aria-live="polite">
      <div class="auth-session-error-card">
        <p class="auth-loader-kicker">Сессия не проверена</p>
        <h1>Не удалось проверить аккаунт</h1>
        <p>
          Проверьте подключение к серверу и повторите попытку. Мы не будем показывать лобби или сбрасывать сессию, пока
          проверка не пройдет.
        </p>
        <button class="home-primary-button" type="button" onclick={retrySessionLoad}>Повторить</button>
      </div>
    </main>
  </div>
{:else if session.loaded && user}
  <LobbyPage {user} {loggingOut} createRoomOnOpen={createRoomInLobby} onLogout={handleLogout} onToast={showToast} />
{:else}
  <div class="app-shell">
    <div class="landing-container">
      <Topbar label="Новая голосовая комната">
        <nav class="landing-header-auth" aria-label="Аккаунт">
          <a class="landing-header-login" href="/?auth=login">Войти <ArrowRight size={15} aria-hidden="true" /></a>
        </nav>
      </Topbar>
    </div>

    <main class="landing-layout" id="startScreen" aria-label="Стартовый экран">
      <LandingHero
        {creatingTemp}
        {joining}
        bind:roomCode
        onCreateTemp={handleCreateTemp}
        onJoin={handleJoinRoom}
        onRoomCodeKeydown={handleRoomCodeKeydown}
      />
      <DesktopAppCard />
    </main>
    <footer class="landing-legal">
      <LegalLinks />
    </footer>
  </div>
{/if}

{#if session.loaded && !user && authMode}
  {#key authMode}
    <AuthDialog mode={authMode} onClose={closeAuthDialog} onModeChange={switchAuthMode} />
  {/key}
{/if}

<PermanentRoomOfferDialog
  open={permanentRoomOfferOpen && !user}
  onRegister={registerFromOffer}
  onContinue={continueAsGuest}
  onClose={() => (permanentRoomOfferOpen = false)}
/>

{#if offerAuthMode && !user}
  {#key offerAuthMode}
    <AuthDialog
      mode={offerAuthMode}
      onClose={() => (offerAuthMode = null)}
      onModeChange={(mode: AuthMode) => (offerAuthMode = mode)}
      onAuthenticated={afterOfferAuthenticated}
    />
  {/key}
{/if}

<ToastStack toasts={toastState.items} onDismiss={dismissToast} />

<style>
  .landing-legal {
    padding: 8px 16px 24px;
  }
  :global(.auth-loader-lines) {
    display: grid;
    gap: 10px;
    margin-top: 24px;
  }
  :where(.auth-loader-lines) span {
    height: 10px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--vr-surface-3), var(--vr-surface-3-hover), var(--vr-surface-3));
    animation: auth-loader-shimmer 1.4s ease-in-out infinite;
  }
  :where(.auth-loader-lines) span:nth-child(2) {
    width: 78%;
    margin-inline: auto;
    animation-delay: 0.12s;
  }
  :where(.auth-loader-lines) span:nth-child(3) {
    width: 58%;
    margin-inline: auto;
    animation-delay: 0.24s;
  }
  :global(.landing-container) {
    width: min(100%, 1160px);
    margin-inline: auto;
  }
  :global(body:not([data-screen='room']) .landing-container .topbar) {
    width: 100%;
  }
  :global(.landing-header-login) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 16px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 10px;
    color: var(--vr-text);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
  }
  :global(.landing-header-login:hover) {
    background: var(--vr-hover);
  }
  :global(.landing-layout) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
    align-items: center;
    gap: 40px;
    width: min(100%, 1160px);
    margin-inline: auto;
    padding: 24px 0 40px;
  }
</style>
