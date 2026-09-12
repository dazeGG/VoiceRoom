<script lang="ts">
  import { onMount } from 'svelte';
  import { getAppRealtime } from '$lib/api/realtime';
  import { playRoomChatMessageCue } from '$lib/features/room/client/media/cues';
  import { notificationPreferences } from '$lib/shared/notifications/preferences.svelte';
  import { pushState, replaceState } from '$app/navigation';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { fetchOwnedRooms } from '$lib/api/auth';
  import { createRoom } from '$lib/api/rooms';
  import { clearRoomPresence, roomPresence } from './model/room-presence.svelte';
  import { countUnreadForBadge, syncDesktopBadgeCount } from '$lib/platform/desktop-attention';
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
  import { createNotificationInbox } from '$lib/shared/notifications/inbox.svelte';
  import { fetchNotificationInbox, markAllNotificationsRead, markNotificationRead } from '$lib/api/notifications';
  import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';
  import { ENTER_ROOM_EVENT, friendsState, initLobby, openDm, showHome, showPeople } from './model/friends.svelte';
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
  import {
    applyRoomSwitchDecision,
    readRoomSwitchConfirmEnabled,
    shouldConfirmRoomSwitch
  } from './model/room-switch-confirmation';
  import RoomSwitchDialog from './components/RoomSwitchDialog.svelte';
  import RecoveryCodesOnboarding from './components/RecoveryCodesOnboarding.svelte';
  import { clearSession, consumeExpectedSessionEnd, session as authSession } from '$lib/features/auth/session.svelte';
  import OpenInAppScreen from './components/OpenInAppScreen.svelte';
  import { bindDesktopLinks, type DesktopLink } from '$lib/platform/desktop-links';
  import { bindDesktopCallActions, syncDesktopCallState } from '$lib/platform/desktop-call';
  import { syncDesktopDiagnosticsContext } from '$lib/platform/desktop-diagnostics';
  import {
    buildAppRoomLink,
    consumeInAppRoomNavigation,
    launchAppLink,
    readOpenInAppSignals,
    shouldOfferOpenInApp
  } from '$lib/platform/open-in-app';
  import { openChat, roomUi } from '$lib/features/room/room-ui.svelte';
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
  let settingsTab = $state<'profile' | 'sound' | 'hotkeys' | 'notifications' | 'app' | 'security'>('profile');
  let previewSettingsRoomId = $state('');
  // Room waiting for "switch rooms?" while voice is connected elsewhere.
  let pendingRoomSwitchId = $state('');
  // Room a browser offered to open in the desktop app before joining voice.
  let openInAppRoomId = $state('');
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

  // The server closes the realtime socket with a dedicated code when this
  // device's session was ended elsewhere (another device, password recovery).
  onMount(() => getAppRealtime().onSessionEnded(() => {
    // Our own sign-out or password change already handles the UI.
    if (consumeExpectedSessionEnd() || !authSession.user) return;
    clearSession();
    onToast('Сеанс на этом устройстве завершён. Войдите снова');
  }));

  onMount(() => {
    void refreshRooms();
    void getCapabilityFeature('engagement').then((enabled) => {
      notificationInboxEnabled = enabled;
      if (enabled) void notificationInbox.load();
    });
    // Without this the badge only ever caught up on a reload, so a mention that
    // arrived while the lobby was open stayed invisible until then.
    //
    // The reload is also how a ping becomes audible. The realtime event fires
    // for every message in every room you belong to, so it cannot tell you were
    // the one addressed — the inbox can, because that is exactly what it holds.
    // A rise in its unread count means someone named you, and that is worth a
    // sound even in a room whose messages you muted: muting a room is asking not
    // to hear the conversation, not asking not to be reachable.
    const teardownNotifications = getAppRealtime().subscribe((event) => {
      if (!notificationInboxEnabled) return;
      if (event.type !== 'notification.room.message') return;
      const before = notificationInbox.unreadCount;
      const messageId = event.payload?.message?.id;
      void notificationInbox.load().then(() => {
        if (notificationInbox.unreadCount > before && !notificationPreferences.doNotDisturb) {
          playRoomChatMessageCue(messageId);
        }
      });
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
    if (initialRoomId && shouldOfferOpenInApp(readOpenInAppSignals()) && !consumeInAppRoomNavigation()) {
      // The browser cannot tell whether the desktop app picked the link up, so
      // it waits for an explicit choice instead of joining voice twice.
      openInAppRoomId = initialRoomId;
      friendsState.mode = 'rooms';
      openRoomInApp();
    } else if (initialRoomId) {
      selectRoomForVoiceEntry(initialRoomId);
      friendsState.mode = 'rooms';
    }
    const initialParams = new URLSearchParams(window.location.search);
    const initialDmId = initialParams.get('dm');
    if (!initialRoomId && initialDmId) {
      replaceState('/', {});
      void openDm(initialDmId).catch(() => onToast('Не удалось открыть диалог'));
    }
    // A mention link — from the bell or from a push — lands here rather than on
    // /r/:roomId, so it previews the room and never joins voice.
    const linkedRoomId = initialParams.get('room');
    const linkedMessageId = initialParams.get('message');
    if (!initialRoomId && linkedRoomId && linkedMessageId) {
      replaceState('/', {});
      openRoomMessage(linkedRoomId, linkedMessageId);
    }

    function onEnterRoomRequest(event: Event): void {
      const roomId = event instanceof CustomEvent && typeof event.detail?.roomId === 'string' ? event.detail.roomId : '';
      if (roomId) requestEnterRoom(roomId);
    }

    const teardownDesktopLinks = bindDesktopLinks(openDesktopLink);
    const teardownDesktopCall = bindDesktopCallActions({
      'toggle-mic': toggleActiveVoiceMic,
      'toggle-output': toggleActiveVoiceDeafen,
      disconnect: () => void leaveConnectedVoiceRoom()
    });

    window.addEventListener('voice-room:embedded-leave', onEmbeddedLeave);
    window.addEventListener('voice-room:rooms-changed', onRoomsChanged);
    window.addEventListener('popstate', onPopState);
    window.addEventListener(ENTER_ROOM_EVENT, onEnterRoomRequest);
    return () => {
      window.removeEventListener(ENTER_ROOM_EVENT, onEnterRoomRequest);
      teardownNotifications();
      teardownFriends();
      teardownRooms();
      teardownDesktopLinks();
      teardownDesktopCall();
      syncDesktopCallState({ active: false, micMuted: false, outputMuted: false, roomId: '', roomName: '' });
      syncDesktopBadgeCount(0);
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
    syncDesktopCallState({
      active: Boolean(connectedVoiceRoomId),
      micMuted: voiceSession.muted,
      outputMuted: voiceSession.deafened,
      roomId: connectedVoiceRoomId || '',
      roomName: connectedVoiceRoom ? roomDisplayName(connectedVoiceRoom) : connectedVoiceRoomId || ''
    });
  });

  $effect(() => {
    syncDesktopDiagnosticsContext({ roomId: connectedVoiceRoomId || '', userId: user?.id || '' });
  });

  $effect(() => {
    // Muted chats stay out of the icon count; the mention cue above is not
    // affected by room mutes.
    syncDesktopBadgeCount(countUnreadForBadge({
      friends: friendsState.friends,
      mutes: notificationPreferences,
      roomUnreadById: roomPresence.unreadCountByRoomId,
      rooms
    }));
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

  // Every way into voice goes through here, so switching away from a live call
  // always gets the same question.
  function requestEnterRoom(roomId: string): void {
    const needsConfirmation = shouldConfirmRoomSwitch({
      confirmEnabled: readRoomSwitchConfirmEnabled(),
      connectedRoomId: getActiveVoiceRoomId(),
      targetRoomId: roomId
    });
    if (needsConfirmation) {
      pendingRoomSwitchId = roomId;
      return;
    }
    enterRoom(roomId);
  }

  function resolveRoomSwitch(proceed: boolean, dontAskAgain = false): void {
    const roomId = pendingRoomSwitchId;
    pendingRoomSwitchId = '';
    if (roomId && applyRoomSwitchDecision({ dontAskAgain, proceed })) enterRoom(roomId);
  }

  function roomLabel(roomId: string): string {
    const room = rooms.find((entry) => entry.roomId === roomId);
    return room ? roomDisplayName(room) : roomId;
  }

  function openRoomInApp(): void {
    const link = buildAppRoomLink(openInAppRoomId, window.location.hostname);
    if (!link) {
      continueRoomInBrowser();
      return;
    }
    launchAppLink(link);
  }

  function continueRoomInBrowser(): void {
    const roomId = openInAppRoomId;
    openInAppRoomId = '';
    if (!roomId) return;
    selectRoomForVoiceEntry(roomId);
    friendsState.mode = 'rooms';
  }

  function openDesktopLink(link: DesktopLink): void {
    if (link.kind === 'room') requestEnterRoom(link.roomId);
    else if (link.kind === 'mention') openRoomMessage(link.roomId, link.messageId);
    else if (link.kind === 'dm') void openDm(link.dmId).catch(() => onToast('Не удалось открыть диалог'));
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
    requestEnterRoom(roomId);
  }

  async function handleCreate(payload: { name: string; isStatic: boolean }): Promise<void> {
    if (creating) return;
    creating = true;
    try {
      const roomId = await createRoom(payload);
      createDialogOpen = false;
      requestEnterRoom(roomId);
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

  function openSecuritySettings(): void {
    settingsTab = 'security';
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

  // Which message a mention link asked to show, so the preview opens its chat on
  // it. Scoped to a room so it cannot leak into the next room previewed.
  let previewAnchor = $state<{ roomId: string; messageId: string } | null>(null);

  /**
   * Show a message in its room without joining voice. The old route went through
   * /r/:roomId, which on load means "put me back inside this room" and joined —
   * and it reloaded the page while still failing to open the chat.
   */
  function openRoomMessage(roomId: string, messageId: string): void {
    friendsState.mode = 'rooms';
    if (getActiveVoiceRoomId() === roomId) {
      // Already in that room: its own chat is the one to show.
      openActiveVoiceRoom();
      openChat();
      return;
    }
    previewAnchor = { roomId, messageId };
    selectRoomPreview(roomId);
  }

  function openNotification(item: import('@voice-room/shared/notifications').NotificationItem): void {
    notificationInboxOpen = false;
    openRoomMessage(item.roomId, item.sourceMessageId);
  }
</script>


{#if user}
  <div class="lobby-shell lv dens-cozy">
    <Sidebar
      {user}
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
        <RoomBrowseView {user} room={selectedRoom} onEnter={() => requestEnterRoom(selectedRoom.roomId)} onBack={closeViewedRoom} onOpenSettings={selectedRoom.relationship === 'owner' ? () => (previewSettingsRoomId = selectedRoom.roomId) : undefined} onRoomsChanged={() => { closeViewedRoom(); void refreshRooms(); }} {onToast} />
      {:else if friendsState.mode === 'rooms' && selectedRoom && (!embeddedRoomId || !embeddedRoomVisible)}
        {@const anchor = previewAnchor?.roomId === selectedRoom.roomId ? previewAnchor : null}
        <!-- Keyed on the anchor so a second mention in a room already on screen
             still reopens its chat on the new message. -->
        {#key anchor?.messageId ?? ''}
        <RoomPreviewView {user} room={selectedRoom} initialPanel={anchor ? 'chat' : null} aroundMessageId={anchor?.messageId} onEnter={() => requestEnterRoom(selectedRoom.roomId)} onBack={closeViewedRoom} onOpenSettings={selectedRoom.relationship === 'owner' ? () => (previewSettingsRoomId = selectedRoom.roomId) : undefined} onRoomsChanged={() => { closeViewedRoom(); void refreshRooms(); }} {onToast} />
        {/key}
      {:else if friendsState.mode === 'rooms' && !embeddedRoomVisible}
        <VoiceHome {rooms} onOpenRoom={previewRoom} onCreateRoom={() => (createDialogOpen = true)} onJoinCode={handleJoin} onRoomsChanged={refreshRooms} onOpenRoomSettings={(roomId) => (previewSettingsRoomId = roomId)} {onToast} />
      {:else if friendsState.mode === 'friends' && friendsState.view === 'dm'}
        <DmView selfId={user.id} self={user} />
      {:else if friendsState.mode === 'friends' && friendsState.view === 'people'}
        <PeopleView {user} {onToast} onHome={goHome} />
      {:else if friendsState.mode === 'friends'}
        <VoiceHome {rooms} onOpenRoom={previewRoom} onCreateRoom={() => (createDialogOpen = true)} onJoinCode={handleJoin} onRoomsChanged={refreshRooms} onOpenRoomSettings={(roomId) => (previewSettingsRoomId = roomId)} {onToast} />
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
  <RecoveryCodesOnboarding onCreateCodes={openSecuritySettings} />
  <LobbyRoomSettingsDialog room={previewSettingsRoom} onClose={() => (previewSettingsRoomId = '')} onSaved={refreshRooms} onDeleted={() => { previewSettingsRoomId = ''; closeViewedRoom(); void refreshRooms(); }} {onToast} />
  <RoomSwitchDialog
    open={Boolean(pendingRoomSwitchId)}
    fromName={roomLabel(connectedVoiceRoomId || '')}
    toName={roomLabel(pendingRoomSwitchId)}
    onConfirm={(dontAskAgain) => resolveRoomSwitch(true, dontAskAgain)}
    onCancel={() => resolveRoomSwitch(false)}
  />
  {#if openInAppRoomId}
    <OpenInAppScreen onRetry={openRoomInApp} onContinue={continueRoomInBrowser} />
  {/if}
  {#if notificationInboxEnabled}
    {#if notificationInboxOpen}
      <aside class="notification-inbox-panel" aria-label="Панель уведомлений">
        <NotificationInbox
          inbox={notificationInbox}
          onopen={openNotification}
          onclose={() => (notificationInboxOpen = false)}
        />
      </aside>
    {/if}
  {/if}
{/if}

<style>
  /* The panel clips; the list inside it is what scrolls. */
  .notification-inbox-panel { position: fixed; z-index: 71; left: 326px; bottom: 16px; display: flex; width: min(420px, calc(100vw - 358px)); max-height: min(620px, calc(100vh - 32px)); overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--paper); box-shadow: var(--shadow); }
  .notification-inbox-panel :global(.notification-inbox) { flex: 1 1 auto; min-width: 0; }
  @media (max-width: 900px) {
    .notification-inbox-panel { left: 12px; right: 12px; bottom: 76px; width: auto; max-height: min(560px, calc(100vh - 96px)); }
  }
</style>
