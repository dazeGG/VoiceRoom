<script lang="ts">
  import { onMount } from 'svelte';
  import { createRoom } from '$lib/api/rooms';
  import { fetchDesktopRelease, type DesktopRelease } from '$lib/api/desktop';
  import { logout } from '$lib/api/auth';
  import { clearSession, loadSession, session } from '$lib/features/auth/session.svelte';
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';
  import './styles/home.css';
  import { extractRoomId } from '$lib/shared/utils/room';
  import DesktopAppCard from './components/DesktopAppCard.svelte';
  import EntryCard from './components/EntryCard.svelte';
  import HeroIntro from './components/HeroIntro.svelte';
  import Toast from './components/Toast.svelte';
  import LobbyPage from './LobbyPage.svelte';
  import { copyText, triggerDesktopDownload } from './services/desktop-download';
  import {
    DESKTOP_BUILDS,
    QUARANTINE_CMD,
    desktopDownloadLabel,
    detectDesktopBuildId,
    formatDesktopReleaseMeta
  } from './model/desktop-builds';

  let roomCode = $state('');
  let creatingTemp = $state(false);
  let joining = $state(false);
  let loggingOut = $state(false);
  let authLoadError = $state(false);
  let toast = $state('');
  let toastTimer = 0;

  let selectedBuildId = $state('mac-arm64');
  let appOpen = $state(false);
  let appDownloadState = $state<'idle' | 'loading' | 'done'>('idle');
  let cmdCopied = $state(false);
  let copyResetTimer = 0;
  let downloadTimer = 0;
  let downloadResetTimer = 0;

  let release = $state<DesktopRelease | null>(null);
  let releaseLoading = $state(false);
  let releaseError = $state(false);

  const user = $derived(session.user);
  const showLobby = $derived(session.loaded && Boolean(user));

  const selectedBuild = $derived(DESKTOP_BUILDS.find((build) => build.id === selectedBuildId) ?? DESKTOP_BUILDS[0]);
  const selectedAsset = $derived(release?.assets[selectedBuildId] ?? null);
  const appMeta = $derived(formatDesktopReleaseMeta(selectedBuild, selectedAsset, release, releaseLoading, releaseError));
  const downloadLabel = $derived(desktopDownloadLabel(appDownloadState));

  onMount(() => {
    document.body.dataset.screen = 'start';
    selectedBuildId = detectDesktopBuildId();
    void loadSession().catch(() => {
      authLoadError = true;
    });
    return () => {
      delete document.body.dataset.screen;
      window.clearTimeout(toastTimer);
      window.clearTimeout(copyResetTimer);
      window.clearTimeout(downloadTimer);
      window.clearTimeout(downloadResetTimer);
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

  async function handleCreateTemp(): Promise<void> {
    if (creatingTemp) return;
    creatingTemp = true;
    try {
      const roomId = await createRoom({ isStatic: false });
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
      await logout();
      clearSession();
      showToast('Вы вышли из аккаунта');
    } catch (error) {
      showToast(error instanceof Error && error.message ? error.message : 'Не удалось выйти из аккаунта');
    } finally {
      loggingOut = false;
    }
  }

  function openRoom(roomId: string): void {
    window.location.href = `/r/${encodeURIComponent(roomId)}`;
  }

  async function ensureRelease(): Promise<void> {
    if (release || releaseLoading) return;
    releaseLoading = true;
    releaseError = false;
    try {
      release = await fetchDesktopRelease();
    } catch {
      releaseError = true;
    } finally {
      releaseLoading = false;
    }
  }

  function handleAppDownload(): void {
    if (appDownloadState === 'loading' || releaseLoading) return;
    const asset = selectedAsset;
    if (!asset) {
      void ensureRelease();
      return;
    }

    appDownloadState = 'loading';
    triggerDesktopDownload(asset.url);

    window.clearTimeout(downloadTimer);
    downloadTimer = window.setTimeout(() => {
      appDownloadState = 'done';
    }, 1200);

    window.clearTimeout(downloadResetTimer);
    downloadResetTimer = window.setTimeout(() => {
      appDownloadState = 'idle';
    }, 4800);
  }

  async function copyQuarantineCommand(): Promise<void> {
    try {
      await copyText(QUARANTINE_CMD);
    } catch {
      // Clipboard may be unavailable; still show feedback.
    }

    cmdCopied = true;
    window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => {
      cmdCopied = false;
    }, 2000);
  }

  function toggleApp(): void {
    appOpen = !appOpen;
    if (appOpen) void ensureRelease();
  }

  function showToast(message: string): void {
    toast = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = '';
    }, 2600);
  }
</script>

{#if !session.loaded}
  <div class="app-shell">
    <Topbar label="Voice Room" />
    <main class="auth-loader" aria-label="Загрузка аккаунта" aria-busy="true">
      <div class="auth-loader-card">
        <span class="auth-loader-orb" aria-hidden="true"></span>
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
    <Topbar label="Voice Room" />
    <main class="auth-session-error" aria-label="Ошибка проверки аккаунта" aria-live="polite">
      <div class="auth-session-error-card">
        <p class="auth-loader-kicker">Сессия не проверена</p>
        <h1>Не удалось проверить аккаунт</h1>
        <p>Проверьте подключение к серверу и повторите попытку. Мы не будем показывать лобби или сбрасывать сессию, пока проверка не пройдет.</p>
        <button class="home-primary-button" type="button" onclick={retrySessionLoad}>Повторить</button>
      </div>
    </main>
  </div>
{:else if showLobby}
  <LobbyPage {user} {loggingOut} onLogout={handleLogout} onToast={showToast} />
{:else}
  <div class="app-shell">
    <Topbar label="Новая голосовая комната" />

    <main class="start-layout" id="startScreen" aria-label="Стартовый экран">
      <HeroIntro />

      <div class="home-side">
        <EntryCard
          {creatingTemp}
          {joining}
          bind:roomCode
          onCreateTemp={handleCreateTemp}
          onJoin={handleJoinRoom}
          onRoomCodeKeydown={handleRoomCodeKeydown}
        />

        <DesktopAppCard
          bind:selectedBuildId
          {appOpen}
          {selectedBuild}
          {releaseError}
          {releaseLoading}
          {appDownloadState}
          {cmdCopied}
          {appMeta}
          appDownloadLabel={downloadLabel}
          onToggleApp={toggleApp}
          onDownload={handleAppDownload}
          onCopyCommand={copyQuarantineCommand}
        />
      </div>
    </main>
  </div>
{/if}

<Toast message={toast} />
