<script lang="ts">
  import { onMount } from 'svelte';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { addRoomByCode, fetchOwnedRooms } from '$lib/api/auth';
  import { createRoom } from '$lib/api/rooms';
  import { extractRoomId } from '$lib/shared/utils/room';
  import SettingsModal from './components/SettingsModal.svelte';
  import RoomPage from '$lib/features/room/RoomPage.svelte';
  import { leaveActiveVoiceRoom } from '$lib/features/room/voice-session.svelte';
  import CreateRoomDialog from './components/CreateRoomDialog.svelte';
  import Sidebar from './components/lobby/Sidebar.svelte';
  import HomeView from './components/lobby/HomeView.svelte';
  import DmView from './components/lobby/DmView.svelte';
  import RequestsView from './components/lobby/RequestsView.svelte';
  import AddFriendView from './components/lobby/AddFriendView.svelte';
  import RoomsHomeView from './components/lobby/RoomsHomeView.svelte';
  import RoomBrowseView from './components/lobby/RoomBrowseView.svelte';
  import RoomPreviewView from './components/lobby/RoomPreviewView.svelte';
  import { friendsState, initLobby } from './model/friends.svelte';
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
  import './styles/account-menu.css';
  import './styles/settings.css';

  let { user, loggingOut, onLogout, onToast } = $props<{
    user: AuthUser | null;
    loggingOut: boolean;
    onLogout: () => void;
    onToast: (message: string) => void;
  }>();

  let rooms = $state<OwnedRoom[]>([]);
  let roomCode = $state('');
  let creating = $state(false);
  let createDialogOpen = $state(false);
  let addDialogOpen = $state(false);
  let addRoomCode = $state('');
  let addError = $state('');
  let adding = $state(false);
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
    const teardown = user ? initLobby(user.id) : () => {};

    function onEmbeddedLeave(event: Event): void {
      const closedRoomId = event instanceof CustomEvent && typeof event.detail?.roomId === 'string' ? event.detail.roomId : null;
      const closedViewedRoom = Boolean(closedRoomId && selectedRoomId === closedRoomId);
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
    window.addEventListener('popstate', onPopState);
    return () => {
      teardown();
      window.removeEventListener('voice-room:embedded-leave', onEmbeddedLeave);
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

  function leaveConnectedVoiceRoom(): void {
    const leavingRoomId = connectedVoiceRoomId;
    const transition = resolveLeaveViewedConnectedRoom(leavingRoomId);
    leaveActiveVoiceRoom();
    if (transition.closeEmbeddedRoom) {
      closeEmbeddedRoom();
      clearViewedRoom();
    }
  }

  function handleJoin(): void {
    const roomId = extractRoomId(roomCode);
    if (!roomId) {
      onToast('Введите код комнаты');
      return;
    }
    enterRoom(roomId);
  }

  async function handleCreate(payload: { name: string; roomPresetKey: string; isStatic: boolean }): Promise<void> {
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

  async function handleAddRoom(event: Event): Promise<void> {
    event.preventDefault();
    if (adding) return;
    const roomId = extractRoomId(addRoomCode);
    if (!roomId) {
      addError = 'Введите код постоянной комнаты';
      return;
    }
    adding = true;
    addError = '';
    try {
      await addRoomByCode(roomId);
      addDialogOpen = false;
      addRoomCode = '';
      await refreshRooms();
      onToast('Комната добавлена');
    } catch (error) {
      addError = error instanceof Error && error.message ? error.message : 'Не удалось добавить комнату';
    } finally {
      adding = false;
    }
  }

  function closeAddDialog(): void {
    if (adding) return;
    addDialogOpen = false;
    addError = '';
  }

  function onDialogOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) closeAddDialog();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (addDialogOpen && event.key === 'Escape') closeAddDialog();
  }

  function openSettings(): void {
    settingsTab = 'profile';
    settingsOpen = true;
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if user}
  <div class="lobby-shell">
    <Sidebar
      {user}
      {rooms}
      bind:roomCode
      selectedRoomId={selectedRoomId}
      onOpenRoom={previewRoom}
      onCreateRoom={() => (createDialogOpen = true)}
      onJoinRoom={handleJoin}
      onAddRoom={() => (addDialogOpen = true)}
      onOpenSettings={openSettings}
      activeVoiceRoomId={connectedVoiceRoomId}
      activeVoiceRoomName={connectedVoiceRoom ? roomDisplayName(connectedVoiceRoom) : connectedVoiceRoomId || ''}
      onOpenVoiceRoom={openConnectedVoiceRoom}
      onLeaveVoiceRoom={leaveConnectedVoiceRoom}
    />

    <main class="lobby-main" aria-label="Главная Voice Room">
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
        <RoomsHomeView {rooms} onCreateRoom={() => (createDialogOpen = true)} onOpenRoom={previewRoom} />
      {:else if friendsState.mode === 'friends' && friendsState.view === 'dm'}
        <DmView selfId={user.id} />
      {:else if friendsState.mode === 'friends' && friendsState.view === 'requests'}
        <RequestsView {onToast} />
      {:else if friendsState.mode === 'friends' && friendsState.view === 'add'}
        <AddFriendView {user} {onToast} />
      {:else if friendsState.mode === 'friends'}
        <HomeView {user} {rooms} onOpenRoom={previewRoom} />
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

  {#if addDialogOpen}
    <div class="dialog-overlay" role="presentation" onclick={onDialogOverlayClick}>
      <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="addRoomTitle">
        <div class="dialog-head">
          <span class="dialog-title" id="addRoomTitle">Добавить комнату</span>
          <button class="dialog-close" type="button" aria-label="Закрыть" onclick={closeAddDialog}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
          </button>
        </div>

        <form class="dialog-body" onsubmit={handleAddRoom}>
          <p class="dialog-note">Введите код уже созданной постоянной комнаты. Временные комнаты в список не добавляются.</p>
          {#if addError}
            <p class="dialog-error" role="alert">{addError}</p>
          {/if}
          <div class="dialog-field">
            <div class="dialog-label">Код комнаты</div>
            <input
              class="dialog-input dialog-input--mono"
              maxlength="120"
              placeholder="x7m2kq9p"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
              bind:value={addRoomCode}
            />
          </div>

          <div class="dialog-actions">
            <button class="dialog-cancel" type="button" onclick={closeAddDialog}>Отмена</button>
            <button class="dialog-submit" type="submit" disabled={adding}>
              {#if adding}<span class="home-spinner" aria-hidden="true"></span>{/if}
              Добавить
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
{/if}
