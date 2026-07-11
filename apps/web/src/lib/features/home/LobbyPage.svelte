<script lang="ts">
  import { onMount } from 'svelte';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { fetchOwnedRooms } from '$lib/api/auth';
  import { createRoom } from '$lib/api/rooms';
  import { clearRoomPresence } from './model/room-presence.svelte';
  import { initLobbyRoomRealtime } from './model/room-realtime';
  import { extractRoomId } from '$lib/shared/utils/room';
  import SettingsModal from './components/SettingsModal.svelte';
  import RoomPage from '$lib/features/room/RoomPage.svelte';
  import {
    leaveActiveVoiceRoomWithCue,
    toggleActiveVoiceMic,
    toggleActiveVoiceDeafen,
    voiceSession
  } from '$lib/features/room/voice-session.svelte';
  import CreateRoomDialog from './components/CreateRoomDialog.svelte';
  import Sidebar from './components/lobby/Sidebar.svelte';
  import VoiceHome from './components/lobby/VoiceHome.svelte';
  import DmView from './components/lobby/DmView.svelte';
  import PeopleView from './components/lobby/PeopleView.svelte';
  import RoomBrowseView from './components/lobby/RoomBrowseView.svelte';
  import RoomPreviewView from './components/lobby/RoomPreviewView.svelte';
  import { friendsState, initLobby, showHome, showPeople } from './model/friends.svelte';
  import {
    getActiveVoiceRoomId,
    clearDisconnectedHiddenEmbed,
    clearEmbeddedRoom as clearEmbeddedRoomState,
    clearViewedRoom,
    connectedRoomIsViewed,
    embeddedRoomIsVisible,
    leaveViewedConnectedRoom as resolveLeaveViewedConnectedRoom,
    openActiveVoiceRoom,
    roomNavigation,
    routeToHome,
    selectRoomForVoiceEntry,
    selectRoomPreview,
    setViewedRoomFromRoute
  } from './model/room-navigation.svelte';
  import { roomDisplayName } from './model/rooms';
  import { roomUi } from '$lib/features/room/room-ui.svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/dialog.css';
  import '$lib/features/room/styles/chat-rail.css';
  import './styles/friends.css';
  import './styles/settings.css';
  import './styles/lobby-v2.css';

  let { user, loggingOut, onLogout, onToast } = $props<{
    user: AuthUser | null;
    loggingOut: boolean;
    onLogout: () => void;
    onToast: (message: string) => void;
  }>();

  let rooms = $state<OwnedRoom[]>([]);
  let creating = $state(false);
  let createDialogOpen = $state(false);
  let settingsOpen = $state(false);
  let settingsTab = $state<'profile' | 'sound'>('profile');
  const selectedRoomId = $derived(roomNavigation.viewedRoomId);
  const embeddedRoomId = $derived(roomNavigation.embeddedRoomId);
  const autoJoinRoomId = $derived(roomNavigation.joinIntentRoomId);
  const connectedVoiceRoomId = $derived(getActiveVoiceRoomId());
  const selectedRoom = $derived(rooms.find((room) => room.roomId === selectedRoomId) ?? null);
  const connectedVoiceRoom = $derived(rooms.find((room) => room.roomId === connectedVoiceRoomId) ?? null);
  const connectedRoomVisible = $derived(connectedRoomIsViewed(friendsState.mode));
  const embeddedRoomVisible = $derived(embeddedRoomIsVisible(friendsState.mode));


  function setRoomPeerCount(roomId: string, peers: number): void {
    rooms = rooms.map((room) => room.roomId === roomId ? { ...room, peers: Math.max(0, peers) } : room);
  }

  function decrementRoomPeerCount(roomId: string | null): void {
    if (!roomId) return;
    const current = rooms.find((room) => room.roomId === roomId)?.peers ?? 0;
    setRoomPeerCount(roomId, Math.max(0, current - 1));
    clearRoomPresence(roomId);
    void refreshRooms();
  }

  function restoreLobbyDocumentState(): void {
    document.body.dataset.screen = 'start';
    delete document.body.dataset.chatOpen;
    delete document.body.dataset.lobbyEmbedded;
    delete document.body.dataset.screenView;
    delete document.body.dataset.stripCollapsed;
    document.title = 'Voice Room';
  }

  function closeEmbeddedRoom({ replaceUrl = true, closedRoomId = embeddedRoomId }: { replaceUrl?: boolean; closedRoomId?: string | null } = {}): void {
    const shouldReplaceUrl = Boolean(replaceUrl && closedRoomId && selectedRoomId === closedRoomId);
    clearEmbeddedRoomState();
    restoreLobbyDocumentState();
    if (shouldReplaceUrl) {
      history.replaceState(null, '', '/');
    }
  }

  onMount(() => {
    void refreshRooms();
    const teardownFriends = user ? initLobby(user.id) : () => {};
    const teardownRooms = user
      ? initLobbyRoomRealtime(
          (updater) => {
            rooms = updater(rooms);
          },
          () => {
            void refreshRooms();
          }
        )
      : () => {};

    function onEmbeddedLeave(event: Event): void {
      const closedRoomId = event instanceof CustomEvent && typeof event.detail?.roomId === 'string' ? event.detail.roomId : null;
      const closedViewedRoom = Boolean(closedRoomId && selectedRoomId === closedRoomId);
      decrementRoomPeerCount(closedRoomId);
      closeEmbeddedRoom({ closedRoomId });
      if (closedViewedRoom) clearViewedRoom();
    }

    function onPopState(): void {
      const roomId = extractRoomId(window.location.pathname);
      if (roomId) {
        setViewedRoomFromRoute(roomId);
        friendsState.mode = 'rooms';
        return;
      }
      const transition = routeToHome();
      if (transition.closeEmbeddedRoom) closeEmbeddedRoom({ replaceUrl: false });
    }

    function onRoomsChanged(): void {
      void refreshRooms();
    }

    // On a fresh load/reload the URL is the only persisted state, so a /r/:id
    // route means the user wants to be back inside that room. Enter with
    // auto-join (like the "Войти" button) instead of only previewing — otherwise
    // temporary rooms (absent from "Мои комнаты") leave the user stranded on the
    // rooms home with the route still pointing at the room.
    const initialRoomId = extractRoomId(window.location.pathname);
    if (initialRoomId) {
      selectRoomForVoiceEntry(initialRoomId);
      friendsState.mode = 'rooms';
    }

    window.addEventListener('voice-room:embedded-leave', onEmbeddedLeave);
    window.addEventListener('voice-room:rooms-changed', onRoomsChanged);
    window.addEventListener('popstate', onPopState);
    return () => {
      teardownFriends();
      teardownRooms();
      window.removeEventListener('voice-room:embedded-leave', onEmbeddedLeave);
      window.removeEventListener('voice-room:rooms-changed', onRoomsChanged);
      window.removeEventListener('popstate', onPopState);
    };
  });

  $effect(() => {
    if (!embeddedRoomId) {
      delete document.body.dataset.lobbyEmbedded;
      return;
    }
    if (embeddedRoomVisible) {
      document.body.dataset.screen = 'room';
      document.body.dataset.lobbyEmbedded = 'true';
      // Re-show clears data-chat-open below on hide, but RoomChat's own effect
      // won't re-fire (chatOpen didn't change), so the stage/dock wouldn't shift
      // back for an already-open chat. Sync it from the shared state here.
      document.body.dataset.chatOpen = roomUi.chatOpen ? 'true' : 'false';
      return;
    }
    document.body.dataset.screen = 'start';
    delete document.body.dataset.chatOpen;
    delete document.body.dataset.lobbyEmbedded;
    delete document.body.dataset.screenView;
    delete document.body.dataset.stripCollapsed;
  });

  $effect(() => {
    void connectedRoomVisible;
    if (!connectedVoiceRoomId && embeddedRoomId && selectedRoomId !== embeddedRoomId) {
      clearDisconnectedHiddenEmbed();
    }
  });

  async function refreshRooms(): Promise<void> {
    try {
      rooms = await fetchOwnedRooms();
    } catch (error) {
      rooms = [];
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось загрузить комнаты');
    }
  }

  // Explicit voice enter/switch path. Browsing a room uses previewRoom(); this
  // path may remount the room client because the user chose to enter voice here.
  function enterRoom(roomId: string): void {
    selectRoomForVoiceEntry(roomId);
    friendsState.mode = 'rooms';
    history.pushState(null, '', `/r/${encodeURIComponent(roomId)}`);
  }

  function previewRoom(roomId: string): void {
    selectRoomPreview(roomId);
    friendsState.mode = 'rooms';
    history.pushState(null, '', `/r/${encodeURIComponent(roomId)}`);
  }

  function closeViewedRoom(): void {
    const transition = routeToHome();
    if (transition.closeEmbeddedRoom) closeEmbeddedRoom({ replaceUrl: false });
    history.pushState(null, '', '/');
  }

  function openConnectedVoiceRoom(): void {
    const openedRoomId = openActiveVoiceRoom();
    if (!openedRoomId) return;
    friendsState.mode = 'rooms';
    history.pushState(null, '', `/r/${encodeURIComponent(openedRoomId)}`);
  }

  async function leaveConnectedVoiceRoom(): Promise<void> {
    const leavingRoomId = connectedVoiceRoomId;
    const transition = resolveLeaveViewedConnectedRoom(leavingRoomId);
    await leaveActiveVoiceRoomWithCue();
    decrementRoomPeerCount(leavingRoomId);
    if (transition.closeEmbeddedRoom) {
      closeEmbeddedRoom();
      clearViewedRoom();
    }
  }

  function handleJoin(code: string): void {
    const roomId = extractRoomId(code);
    if (!roomId) {
      onToast('Введите код комнаты');
      return;
    }
    enterRoom(roomId);
  }

  async function handleCreate(payload: { name: string; isStatic: boolean }): Promise<void> {
    if (creating) return;
    creating = true;
    try {
      const roomId = await createRoom(payload);
      if (payload.isStatic) {
        createDialogOpen = false;
        await refreshRooms();
        onToast('Комната создана');
      } else {
        enterRoom(roomId);
      }
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
    } finally {
      creating = false;
    }
  }

  function openSettings(): void {
    settingsTab = 'profile';
    settingsOpen = true;
  }

  function openPeople(): void {
    friendsState.mode = 'friends';
    showPeople();
  }

  function goHome(): void {
    showHome();
    if (selectedRoomId) closeViewedRoom();
  }
</script>


{#if user}
  <div class="lobby-shell lv dens-cozy">
    <Sidebar
      {user}
      onGoHome={goHome}
      onOpenPeople={openPeople}
      onOpenSettings={openSettings}
      activeVoiceRoomId={connectedVoiceRoomId}
      activeVoiceRoomName={connectedVoiceRoom ? roomDisplayName(connectedVoiceRoom) : connectedVoiceRoomId || ''}
      activeVoiceMuted={voiceSession.muted}
      activeVoiceDeafened={voiceSession.deafened}
      onOpenVoiceRoom={openConnectedVoiceRoom}
      onLeaveVoiceRoom={leaveConnectedVoiceRoom}
      onToggleVoiceMic={toggleActiveVoiceMic}
      onToggleVoiceDeafen={toggleActiveVoiceDeafen}
    />

    <main class="lobby-main lv-main" aria-label="Главная Voice Room">
      {#if embeddedRoomId}
        <div class="lobby-embedded-room" hidden={!embeddedRoomVisible}>
          {#key embeddedRoomId}
            <RoomPage embeddedRoomId={embeddedRoomId} autoJoin={autoJoinRoomId === embeddedRoomId} />
          {/key}
        </div>
      {/if}

      {#if friendsState.mode === 'rooms' && selectedRoom && connectedVoiceRoomId && selectedRoom.roomId !== connectedVoiceRoomId}
        <RoomBrowseView {user} room={selectedRoom} onEnter={() => enterRoom(selectedRoom.roomId)} onBack={closeViewedRoom} {onToast} />
      {:else if friendsState.mode === 'rooms' && selectedRoom && (!embeddedRoomId || !embeddedRoomVisible)}
        <RoomPreviewView {user} room={selectedRoom} onEnter={() => enterRoom(selectedRoom.roomId)} onBack={closeViewedRoom} {onToast} />
      {:else if friendsState.mode === 'rooms' && !embeddedRoomVisible}
        <VoiceHome {user} {rooms} onOpenRoom={previewRoom} onCreateRoom={() => (createDialogOpen = true)} onJoinCode={handleJoin} />
      {:else if friendsState.mode === 'friends' && friendsState.view === 'dm'}
        <DmView selfId={user.id} onHome={goHome} />
      {:else if friendsState.mode === 'friends' && friendsState.view === 'people'}
        <PeopleView {user} {onToast} onHome={goHome} />
      {:else if friendsState.mode === 'friends'}
        <VoiceHome {user} {rooms} onOpenRoom={previewRoom} onCreateRoom={() => (createDialogOpen = true)} onJoinCode={handleJoin} />
      {/if}
    </main>
  </div>

  <CreateRoomDialog open={createDialogOpen} {creating} onClose={() => (createDialogOpen = false)} onCreate={handleCreate} />
  <SettingsModal
    open={settingsOpen}
    bind:tab={settingsTab}
    {user}
    {loggingOut}
    onClose={() => (settingsOpen = false)}
    {onToast}
    {onLogout}
  />
{/if}
