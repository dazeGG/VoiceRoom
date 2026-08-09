<script lang="ts">
  import { onMount } from 'svelte';
  import { pushState, replaceState } from '$app/navigation';
  import { X } from '@lucide/svelte';
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
  import LobbyRoomSettingsDialog from './components/lobby/LobbyRoomSettingsDialog.svelte';
  import NotificationInbox from './components/NotificationInbox.svelte';
  import { createNotificationInbox, notificationRoute } from '$lib/shared/notifications/inbox.svelte';
  import { fetchNotificationInbox, markAllNotificationsRead, markNotificationRead } from '$lib/api/notifications';
  import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { friendsState, initLobby, openDm, showHome, showPeople } from './model/friends.svelte';
  import type { ToastOptions } from './model/toasts.svelte';
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
    onToast: (message: string, options?: ToastOptions) => void;
  }>();

  let rooms = $state<OwnedRoom[]>([]);
  let creating = $state(false);
  let createDialogOpen = $state(false);
  let settingsOpen = $state(false);
  let settingsTab = $state<'profile' | 'sound' | 'hotkeys' | 'notifications'>('profile');
  let previewSettingsRoomId = $state('');
  let notificationInboxEnabled = $state(false);
  let notificationInboxOpen = $state(false);
  const notificationInbox = createNotificationInbox({
    list: fetchNotificationInbox,
    read: markNotificationRead,
    readAll: markAllNotificationsRead
  });
  const selectedRoomId = $derived(roomNavigation.viewedRoomId);
  const embeddedRoomId = $derived(roomNavigation.embeddedRoomId);
  const autoJoinRoomId = $derived(roomNavigation.joinIntentRoomId);
  const connectedVoiceRoomId = $derived(getActiveVoiceRoomId());
  const selectedRoom = $derived(rooms.find((room) => room.roomId === selectedRoomId) ?? null);
  const previewSettingsRoom = $derived(rooms.find((room) => room.roomId === previewSettingsRoomId) ?? null);
  const connectedVoiceRoom = $derived(rooms.find((room) => room.roomId === connectedVoiceRoomId) ?? null);
  const notificationUsers = $derived(
    [...friendsState.friends]
      .sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0))
      .map((entry) => entry.user)
  );
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

  function replaceUrlWithActiveVoiceRoom(roomId: string | null = connectedVoiceRoomId): void {
    const target = roomId ? `/r/${encodeURIComponent(roomId)}` : '/';
    if (`${window.location.pathname}${window.location.search}` === target) return;
    replaceState(target, {});
  }

  function closeEmbeddedRoom({ replaceUrl = true, closedRoomId = embeddedRoomId }: { replaceUrl?: boolean; closedRoomId?: string | null } = {}): void {
    const shouldReplaceUrl = Boolean(replaceUrl && closedRoomId && extractRoomId(window.location.pathname) === closedRoomId);
    clearEmbeddedRoomState();
    restoreLobbyDocumentState();
    if (shouldReplaceUrl) {
      replaceUrlWithActiveVoiceRoom(connectedVoiceRoomId === closedRoomId ? null : connectedVoiceRoomId);
    }
  }

  onMount(() => {
    void refreshRooms();
    void getCapabilityFeature('engagement').then((enabled) => {
      notificationInboxEnabled = enabled;
      if (enabled) void notificationInbox.load();
    });
    const teardownFriends = user ? initLobby(user.id, user.doNotDisturb, user.presenceStatus) : () => {};
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
        replaceUrlWithActiveVoiceRoom();
        return;
      }
      const transition = routeToHome();
      if (transition.closeEmbeddedRoom) closeEmbeddedRoom({ replaceUrl: false });
      replaceUrlWithActiveVoiceRoom();
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
    const initialDmId = new URLSearchParams(window.location.search).get('dm');
    if (!initialRoomId && initialDmId) {
      replaceState('/', {});
      void openDm(initialDmId).catch(() => onToast('Не удалось открыть диалог'));
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
    pushState(`/r/${encodeURIComponent(roomId)}`, {});
  }

  function previewRoom(roomId: string): void {
    selectRoomPreview(roomId);
    friendsState.mode = 'rooms';
    replaceUrlWithActiveVoiceRoom();
  }

  function closeViewedRoom(): void {
    const transition = routeToHome();
    if (transition.closeEmbeddedRoom) closeEmbeddedRoom({ replaceUrl: false });
    replaceUrlWithActiveVoiceRoom();
  }

  function openConnectedVoiceRoom(): void {
    const openedRoomId = openActiveVoiceRoom();
    if (!openedRoomId) return;
    friendsState.mode = 'rooms';
    pushState(`/r/${encodeURIComponent(openedRoomId)}`, {});
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
    replaceUrlWithActiveVoiceRoom(null);
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
      createDialogOpen = false;
      enterRoom(roomId);
      if (payload.isStatic) void refreshRooms();
      onToast('Комната создана');
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

  function openNotification(item: import('@voice-room/shared/notifications').NotificationItem): void {
    notificationInboxOpen = false;
    window.location.assign(notificationRoute(item));
  }
</script>


{#if user}
  <div class="lobby-shell lv dens-cozy">
    <Sidebar
      {user}
      {rooms}
      onGoHome={goHome}
      onOpenPeople={openPeople}
      onOpenSettings={openSettings}
      notificationsEnabled={notificationInboxEnabled}
      notificationsOpen={notificationInboxOpen}
      notificationUnreadCount={notificationInbox.unreadCount}
      onOpenNotifications={() => {
        notificationInboxOpen = !notificationInboxOpen;
        if (notificationInboxOpen) void notificationInbox.load();
      }}
      {onToast}
      activeVoiceRoomId={connectedVoiceRoomId}
      activeVoiceRoomName={connectedVoiceRoom ? roomDisplayName(connectedVoiceRoom) : connectedVoiceRoomId || ''}
      activeVoiceRoomAvatarUrl={connectedVoiceRoom?.avatarUrl ?? null}
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
        <RoomBrowseView {user} room={selectedRoom} onEnter={() => enterRoom(selectedRoom.roomId)} onBack={closeViewedRoom} onOpenSettings={selectedRoom.relationship === 'owner' ? () => (previewSettingsRoomId = selectedRoom.roomId) : undefined} {onToast} />
      {:else if friendsState.mode === 'rooms' && selectedRoom && (!embeddedRoomId || !embeddedRoomVisible)}
        <RoomPreviewView {user} room={selectedRoom} onEnter={() => enterRoom(selectedRoom.roomId)} onBack={closeViewedRoom} onOpenSettings={selectedRoom.relationship === 'owner' ? () => (previewSettingsRoomId = selectedRoom.roomId) : undefined} {onToast} />
      {:else if friendsState.mode === 'rooms' && !embeddedRoomVisible}
        <VoiceHome {rooms} onOpenRoom={previewRoom} onCreateRoom={() => (createDialogOpen = true)} onJoinCode={handleJoin} onRoomsChanged={refreshRooms} {onToast} />
      {:else if friendsState.mode === 'friends' && friendsState.view === 'dm'}
        <DmView selfId={user.id} self={user} />
      {:else if friendsState.mode === 'friends' && friendsState.view === 'people'}
        <PeopleView {user} {onToast} onHome={goHome} />
      {:else if friendsState.mode === 'friends'}
        <VoiceHome {rooms} onOpenRoom={previewRoom} onCreateRoom={() => (createDialogOpen = true)} onJoinCode={handleJoin} onRoomsChanged={refreshRooms} {onToast} />
      {/if}
    </main>
  </div>

  <CreateRoomDialog open={createDialogOpen} {creating} onClose={() => (createDialogOpen = false)} onCreate={handleCreate} />
  <SettingsModal
    open={settingsOpen}
    bind:tab={settingsTab}
    {user}
    {notificationUsers}
    notificationRooms={rooms}
    {loggingOut}
    onClose={() => (settingsOpen = false)}
    {onToast}
    {onLogout}
  />
  <LobbyRoomSettingsDialog room={previewSettingsRoom} onClose={() => (previewSettingsRoomId = '')} onSaved={refreshRooms} onDeleted={() => { previewSettingsRoomId = ''; closeViewedRoom(); void refreshRooms(); }} {onToast} />
  {#if notificationInboxEnabled}
    {#if notificationInboxOpen}
      <aside class="notification-inbox-panel" aria-label="Панель уведомлений">
        <button class="notification-inbox-close" type="button" aria-label="Закрыть" onclick={() => (notificationInboxOpen = false)}><X {...iconSm} /></button>
        <NotificationInbox inbox={notificationInbox} onopen={openNotification} />
      </aside>
    {/if}
  {/if}
{/if}

<style>
  .notification-inbox-panel { position: fixed; z-index: 71; left: 326px; bottom: 16px; width: min(420px, calc(100vw - 358px)); max-height: min(620px, calc(100vh - 32px)); overflow: auto; border: 1px solid var(--line); border-radius: 16px; background: var(--paper); box-shadow: var(--shadow); }
  .notification-inbox-panel :global(.notification-inbox) { margin: 18px; }
  .notification-inbox-panel :global(.notification-inbox > header) { padding-right: 36px; }
  .notification-inbox-close { position: absolute; z-index: 1; right: 10px; top: 10px; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 9px; background: var(--paper); color: inherit; cursor: pointer; }
  @media (max-width: 900px) {
    .notification-inbox-panel { left: 12px; right: 12px; bottom: 76px; width: auto; max-height: min(560px, calc(100vh - 96px)); }
  }
</style>
