<script lang="ts">
  import { onMount } from 'svelte';
  import { createRoom, fetchRoomStatus } from '$lib/api/rooms';
  import { fetchDesktopRelease, type DesktopRelease } from '$lib/api/desktop';
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';
  import './styles/home.css';
  import { extractRoomId } from '$lib/shared/utils/room';
  import { cleanDisplayName } from '$lib/shared/utils/text';
  import DesktopAppCard from './components/DesktopAppCard.svelte';
  import HeroIntro from './components/HeroIntro.svelte';
  import NameRoomCard from './components/NameRoomCard.svelte';
  import StaticRoomsCard from './components/StaticRoomsCard.svelte';
  import Toast from './components/Toast.svelte';
  import { copyText, triggerDesktopDownload } from './services/desktop-download';
  import {
    DESKTOP_BUILDS,
    QUARANTINE_CMD,
    desktopDownloadLabel,
    detectDesktopBuildId,
    formatDesktopReleaseMeta
  } from './model/desktop-builds';

  let savedName = $state('');
  let nameInput = $state('');
  let roomCode = $state('');
  let staticRoomEnabled = $state(false);
  let creating = $state(false);
  let addingRoom = $state(false);
  let toast = $state('');
  let toastTimer = 0;
  let staticRooms = $state<SavedStaticRoom[]>([]);

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

  // The room step is gated on an explicitly saved name: it unlocks only while
  // the input still matches what was saved (editing re-locks it).
  const nameMatchesSaved = $derived(Boolean(savedName) && cleanDisplayName(nameInput) === savedName);
  const selectedBuild = $derived(DESKTOP_BUILDS.find((build) => build.id === selectedBuildId) ?? DESKTOP_BUILDS[0]);
  const selectedAsset = $derived(release?.assets[selectedBuildId] ?? null);
  const appMeta = $derived(formatDesktopReleaseMeta(selectedBuild, selectedAsset, release, releaseLoading, releaseError));
  const downloadLabel = $derived(desktopDownloadLabel(appDownloadState));

  interface SavedStaticRoom {
    roomId: string;
    savedAt: number;
  }

  const STATIC_ROOMS_KEY = 'voice-room:static-rooms';

  onMount(() => {
    document.body.dataset.screen = 'start';
    savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
    nameInput = savedName;
    staticRooms = loadStaticRooms();
    selectedBuildId = detectDesktopBuildId();
    return () => {
      delete document.body.dataset.screen;
      window.clearTimeout(toastTimer);
      window.clearTimeout(copyResetTimer);
      window.clearTimeout(downloadTimer);
      window.clearTimeout(downloadResetTimer);
    };
  });

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

  function saveName(event?: Event): void {
    event?.preventDefault();
    const nextName = cleanDisplayName(nameInput);
    if (!nextName) {
      showToast('Введите имя');
      return;
    }
    savedName = nextName;
    nameInput = nextName;
    localStorage.setItem('voice-room:name', nextName);
  }

  async function handleCreateRoom(): Promise<void> {
    if (!nameMatchesSaved || creating) return;

    creating = true;
    try {
      const roomId = await createRoom({ isStatic: staticRoomEnabled });
      if (staticRoomEnabled) {
        upsertStaticRoom(roomId);
      }
      openRoom(roomId);
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
    } finally {
      creating = false;
    }
  }

  function handleJoinRoom(): void {
    if (!nameMatchesSaved) return;
    const roomId = extractRoomId(roomCode);
    if (!roomId) {
      showToast('Введите код комнаты');
      return;
    }
    openRoom(roomId);
  }

  async function handleAddRoom(): Promise<void> {
    if (!nameMatchesSaved || addingRoom) return;

    const roomId = extractRoomId(roomCode);
    if (!roomId) {
      showToast('Введите код комнаты');
      return;
    }

    addingRoom = true;
    try {
      const room = await fetchRoomStatus(roomId);
      if (!room) {
        showToast('Комната не найдена');
        return;
      }
      if (!room.isStatic) {
        showToast('Это не статичная комната');
        return;
      }

      const added = upsertStaticRoom(roomId);
      showToast(added ? 'Комната добавлена в список' : 'Комната уже в списке');
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error && error.message ? error.message : 'Не удалось добавить комнату');
    } finally {
      addingRoom = false;
    }
  }

  function handleRoomCodeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleJoinRoom();
  }

  function openRoom(roomId: string): void {
    window.location.href = `/r/${encodeURIComponent(roomId)}`;
  }

  function loadStaticRooms(): SavedStaticRoom[] {
    try {
      const raw = localStorage.getItem(STATIC_ROOMS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const seen = new Set<string>();
      return parsed
        .map((entry) => {
          const roomId = extractRoomId(entry?.roomId);
          if (!roomId) return null;
          const savedAt = Number(entry?.savedAt);
          return {
            roomId,
            savedAt: Number.isFinite(savedAt) ? savedAt : Date.now()
          } satisfies SavedStaticRoom;
        })
        .filter((entry): entry is SavedStaticRoom => {
          if (!entry || seen.has(entry.roomId)) return false;
          seen.add(entry.roomId);
          return true;
        })
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  }

  function persistStaticRooms(nextRooms: SavedStaticRoom[]): void {
    staticRooms = nextRooms;
    localStorage.setItem(STATIC_ROOMS_KEY, JSON.stringify(nextRooms));
  }

  function upsertStaticRoom(roomId: string): boolean {
    const normalized = extractRoomId(roomId);
    if (!normalized) return false;
    if (staticRooms.some((room) => room.roomId === normalized)) return false;

    persistStaticRooms([{ roomId: normalized, savedAt: Date.now() }, ...staticRooms]);
    return true;
  }

  function removeStaticRoom(roomId: string): void {
    const normalized = extractRoomId(roomId);
    if (!normalized) return;
    persistStaticRooms(staticRooms.filter((room) => room.roomId !== normalized));
  }

  function showToast(message: string): void {
    toast = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = '';
    }, 2600);
  }
</script>

<div class="app-shell">
  <Topbar label="Новая голосовая комната" />

  <main class="start-layout" id="startScreen" aria-label="Стартовый экран">
    <HeroIntro />

    <div class="home-side">
      <NameRoomCard
        bind:nameInput
        bind:roomCode
        bind:staticRoomEnabled
        {savedName}
        {nameMatchesSaved}
        {creating}
        {addingRoom}
        onSaveName={saveName}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        onAddRoom={handleAddRoom}
        onRoomCodeKeydown={handleRoomCodeKeydown}
      />

      <StaticRoomsCard
        rooms={staticRooms}
        onOpenRoom={openRoom}
        onRemoveRoom={removeStaticRoom}
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

<Toast message={toast} />
