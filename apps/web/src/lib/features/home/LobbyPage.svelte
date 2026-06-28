<script lang="ts">
  import { onMount } from 'svelte';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { addRoomByCode, fetchOwnedRooms } from '$lib/api/auth';
  import { createRoom } from '$lib/api/rooms';
  import { extractRoomId } from '$lib/shared/utils/room';
  import SettingsModal from './components/SettingsModal.svelte';
  import RoomPage from '$lib/features/room/RoomPage.svelte';
  import CreateRoomDialog from './components/CreateRoomDialog.svelte';
  import Sidebar from './components/lobby/Sidebar.svelte';
  import HomeView from './components/lobby/HomeView.svelte';
  import DmView from './components/lobby/DmView.svelte';
  import RequestsView from './components/lobby/RequestsView.svelte';
  import AddFriendView from './components/lobby/AddFriendView.svelte';
  import RoomsHomeView from './components/lobby/RoomsHomeView.svelte';
  import RoomPreviewView from './components/lobby/RoomPreviewView.svelte';
  import { friendsState, initLobby } from './model/friends.svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/dialog.css';
  import './styles/friends.css';
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
  let selectedRoomId = $state<string | null>(null);
  let embeddedRoomId = $state<string | null>(null);

  const selectedRoom = $derived(rooms.find((room) => room.roomId === selectedRoomId) ?? null);

  onMount(() => {
    void refreshRooms();
    const teardown = user ? initLobby(user.id) : () => {};
    function restoreLobbyDocumentState(): void {
      document.body.dataset.screen = 'start';
      delete document.body.dataset.chatOpen;
      delete document.body.dataset.screenView;
      delete document.body.dataset.stripCollapsed;
      document.title = 'Voice Room';
    }

    function closeEmbeddedRoom({ replaceUrl = true }: { replaceUrl?: boolean } = {}): void {
      embeddedRoomId = null;
      restoreLobbyDocumentState();
      if (replaceUrl && selectedRoomId) {
        history.replaceState(null, '', '/');
      }
    }

    function onEmbeddedLeave(): void {
      closeEmbeddedRoom();
    }

    function onPopState(): void {
      const roomId = extractRoomId(window.location.pathname);
      if (roomId) {
        selectedRoomId = roomId;
        embeddedRoomId = roomId;
        friendsState.mode = 'rooms';
        return;
      }
      if (embeddedRoomId) closeEmbeddedRoom({ replaceUrl: false });
    }

    window.addEventListener('voice-room:embedded-leave', onEmbeddedLeave);
    window.addEventListener('popstate', onPopState);
    return () => {
      teardown();
      window.removeEventListener('voice-room:embedded-leave', onEmbeddedLeave);
      window.removeEventListener('popstate', onPopState);
    };
  });

  async function refreshRooms(): Promise<void> {
    try {
      rooms = await fetchOwnedRooms();
    } catch (error) {
      rooms = [];
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось загрузить комнаты');
    }
  }

  function openRoom(roomId: string): void {
    selectedRoomId = roomId;
    embeddedRoomId = roomId;
    history.pushState(null, '', `/r/${encodeURIComponent(roomId)}`);
  }

  function previewRoom(roomId: string): void {
    selectedRoomId = roomId;
    friendsState.mode = 'rooms';
  }

  function handleJoin(): void {
    const roomId = extractRoomId(roomCode);
    if (!roomId) {
      onToast('Введите код комнаты');
      return;
    }
    openRoom(roomId);
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
        openRoom(roomId);
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
    />

    <main class="lobby-main" aria-label="Главная Voice Room">
      {#if embeddedRoomId}
        {#key embeddedRoomId}
          <RoomPage embeddedRoomId={embeddedRoomId} />
        {/key}
      {:else if selectedRoom}
        <RoomPreviewView room={selectedRoom} onEnter={() => openRoom(selectedRoom.roomId)} onBack={() => (selectedRoomId = null)} />
      {:else if friendsState.mode === 'rooms'}
        <RoomsHomeView {rooms} onCreateRoom={() => (createDialogOpen = true)} onOpenRoom={previewRoom} />
      {:else if friendsState.view === 'dm'}
        <DmView selfId={user.id} />
      {:else if friendsState.view === 'requests'}
        <RequestsView {onToast} />
      {:else if friendsState.view === 'add'}
        <AddFriendView {user} {onToast} />
      {:else}
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
