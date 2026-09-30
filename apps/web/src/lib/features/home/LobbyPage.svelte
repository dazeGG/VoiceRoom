<script lang="ts">
  import { onMount } from 'svelte';
  import { getAppRealtime } from '$lib/api/realtime';
  import { pushState, replaceState } from '$app/navigation';
  import type { AuthUser } from '$lib/api/auth';
  import { createRoom } from '$lib/api/rooms';
  import { extractRoomId } from '$lib/shared/utils/room';
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
  import { ProfileCardHost } from './components/profile-card';
  import { ENTER_ROOM_EVENT, LobbyStore } from './model/lobby.svelte';
  import { LobbyNotifications } from './model/lobby-notifications.svelte';
  import { syncLobbyWithDesktop } from './model/desktop-sync.svelte';
  import { provideLobby } from './model/lobby-context';
  import { provideRoomSocial } from '$lib/features/room/social';
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
  import { LobbyRooms } from './model/lobby-rooms.svelte';
  import { AccountPrompts } from './model/account-prompts.svelte';
  import LobbyAccountDialogs from './components/LobbyAccountDialogs.svelte';
  import {
    applyRoomSwitchDecision,
    readRoomSwitchConfirmEnabled,
    shouldConfirmRoomSwitch
  } from './model/room-switch-confirmation';
  import RoomSwitchDialog from './components/RoomSwitchDialog.svelte';
  import { clearSession, consumeExpectedSessionEnd, session as authSession } from '$lib/features/auth/session.svelte';
  import OpenInAppScreen from './components/OpenInAppScreen.svelte';
  import { bindDesktopLinks, type DesktopLink } from '$lib/platform/desktop-links';
  import {
    buildAppRoomLink,
    consumeInAppRoomNavigation,
    launchAppLink,
    readOpenInAppSignals,
    shouldOfferOpenInApp
  } from '$lib/platform/open-in-app';
  import { openChat, roomUi } from '$lib/features/room/room-ui.svelte';
  import { state as roomClientState } from '$lib/features/room/client/core/state.svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/dialog.css';
  import '$lib/features/room/styles/chat-rail.css';
  import './styles/friends.css';
  import '$lib/shared/styles/settings.css';
  import './styles/lobby-v2.css';

  const lobby = new LobbyStore();
  provideLobby(lobby);

  // Rooms shown inside the lobby see the account's friends through this.
  provideRoomSocial(lobby.roomSocial);

  let { user, loggingOut, onLogout, onToast } = $props<{
    user: AuthUser | null;
    loggingOut: boolean;
    onLogout: () => void;
    onToast: (message: string, options?: ToastOptions) => void;
  }>();

  const rooms = new LobbyRooms((message) => onToast(message));
  let creating = $state(false);
  let createDialogOpen = $state(false);
  let previewSettingsRoomId = $state('');
  // Room waiting for "switch rooms?" while voice is connected elsewhere.
  let pendingRoomSwitchId = $state('');
  // Room a browser offered to open in the desktop app before joining voice.
  let openInAppRoomId = $state('');
  const notifications = new LobbyNotifications();
  const selectedRoomId = $derived(roomNavigation.viewedRoomId);
  const embeddedRoomId = $derived(roomNavigation.embeddedRoomId);
  const autoJoinRoomId = $derived(roomNavigation.joinIntentRoomId);
  const connectedVoiceRoomId = $derived(getActiveVoiceRoomId());

  const prompts = new AccountPrompts({
    user: () => user,
    voiceActive: () => Boolean(connectedVoiceRoomId || roomNavigation.joinIntentRoomId),
    onToast: (message, options) => onToast(message, options)
  });

  const selectedRoom = $derived(rooms.find(selectedRoomId));
  const previewSettingsRoom = $derived(rooms.find(previewSettingsRoomId));
  const connectedVoiceRoom = $derived(rooms.find(connectedVoiceRoomId));
  // A room the list does not have (a temporary one, or one not kept yet) is
  // named by the room client that is connected to it.
  const connectedVoiceRoomName = $derived(
    connectedVoiceRoom
      ? roomDisplayName(connectedVoiceRoom)
      : (roomClientState.roomId === connectedVoiceRoomId && roomClientState.roomName) || connectedVoiceRoomId || ''
  );
  const notificationUsers = $derived(
    [...lobby.friends]
      .sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0))
      .map((entry) => entry.user)
  );
  const connectedRoomVisible = $derived(connectedRoomIsViewed(lobby.mode));
  const embeddedRoomVisible = $derived(embeddedRoomIsVisible(lobby.mode));

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

  function closeEmbeddedRoom({
    replaceUrl = true,
    closedRoomId = embeddedRoomId
  }: { replaceUrl?: boolean; closedRoomId?: string | null } = {}): void {
    const shouldReplaceUrl = Boolean(
      replaceUrl && closedRoomId && extractRoomId(window.location.pathname) === closedRoomId
    );
    clearEmbeddedRoomState();
    restoreLobbyDocumentState();
    if (shouldReplaceUrl) {
      replaceUrlWithActiveVoiceRoom(connectedVoiceRoomId === closedRoomId ? null : connectedVoiceRoomId);
    }
  }

  // The server closes the realtime socket with a dedicated code when this
  // device's session was ended elsewhere (another device, password recovery).
  onMount(() =>
    getAppRealtime().onSessionEnded(() => {
      // Our own sign-out or password change already handles the UI.
      if (consumeExpectedSessionEnd() || !authSession.user) return;
      clearSession();
      onToast('Сеанс на этом устройстве завершён. Войдите снова');
    })
  );

  onMount(() => {
    void rooms.refresh();
    prompts.start();
    const teardownNotifications = notifications.start();
    const teardownFriends = user ? lobby.init(user.id, user.doNotDisturb, user.presenceStatus) : () => {};
    const teardownRooms = user ? rooms.follow() : () => {};

    function onEmbeddedLeave(event: Event): void {
      const closedRoomId =
        event instanceof CustomEvent && typeof event.detail?.roomId === 'string' ? event.detail.roomId : null;
      const closedViewedRoom = Boolean(closedRoomId && selectedRoomId === closedRoomId);
      rooms.left(closedRoomId);
      closeEmbeddedRoom({ closedRoomId });
      if (closedViewedRoom) clearViewedRoom();
    }

    function onPopState(): void {
      const roomId = extractRoomId(window.location.pathname);
      if (roomId) {
        setViewedRoomFromRoute(roomId);
        lobby.mode = 'rooms';
        replaceUrlWithActiveVoiceRoom();
        return;
      }
      const transition = routeToHome();
      if (transition.closeEmbeddedRoom) closeEmbeddedRoom({ replaceUrl: false });
      replaceUrlWithActiveVoiceRoom();
    }

    function onRoomsChanged(): void {
      void rooms.refresh();
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
      lobby.mode = 'rooms';
      openRoomInApp();
    } else if (initialRoomId) {
      selectRoomForVoiceEntry(initialRoomId);
      lobby.mode = 'rooms';
    }
    const initialParams = new URLSearchParams(window.location.search);
    const initialDmId = initialParams.get('dm');
    if (!initialRoomId && initialDmId) {
      replaceState('/', {});
      void lobby.openDm(initialDmId).catch(() => onToast('Не удалось открыть диалог'));
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
      const roomId =
        event instanceof CustomEvent && typeof event.detail?.roomId === 'string' ? event.detail.roomId : '';
      if (roomId) requestEnterRoom(roomId);
    }

    const teardownDesktopLinks = bindDesktopLinks(openDesktopLink);

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

  syncLobbyWithDesktop({
    get userId() {
      return user?.id || '';
    },
    get voiceRoomId() {
      return connectedVoiceRoomId || '';
    },
    get voiceRoomName() {
      return connectedVoiceRoomName;
    },
    get friends() {
      return lobby.friends;
    },
    get rooms() {
      return rooms.list;
    },
    onDisconnect: () => void leaveConnectedVoiceRoom()
  });

  $effect(() => {
    void connectedRoomVisible;
    if (!connectedVoiceRoomId && embeddedRoomId && selectedRoomId !== embeddedRoomId) {
      clearDisconnectedHiddenEmbed();
    }
  });

  // Explicit voice enter/switch path. Browsing a room uses previewRoom(); this
  // path may remount the room client because the user chose to enter voice here.
  function enterRoom(roomId: string): void {
    selectRoomForVoiceEntry(roomId);
    lobby.mode = 'rooms';
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
    lobby.mode = 'rooms';
  }

  function openDesktopLink(link: DesktopLink): void {
    if (link.kind === 'room') requestEnterRoom(link.roomId);
    else if (link.kind === 'mention') openRoomMessage(link.roomId, link.messageId);
    else if (link.kind === 'dm') void lobby.openDm(link.dmId).catch(() => onToast('Не удалось открыть диалог'));
  }

  function previewRoom(roomId: string): void {
    selectRoomPreview(roomId);
    lobby.mode = 'rooms';
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
    lobby.mode = 'rooms';
    pushState(`/r/${encodeURIComponent(openedRoomId)}`, {});
  }

  async function leaveConnectedVoiceRoom(): Promise<void> {
    const leavingRoomId = connectedVoiceRoomId;
    const transition = resolveLeaveViewedConnectedRoom(leavingRoomId);
    await leaveActiveVoiceRoomWithCue();
    rooms.left(leavingRoomId);
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
      if (payload.isStatic) void rooms.refresh();
      onToast('Комната создана');
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
    } finally {
      creating = false;
    }
  }

  function openPeople(): void {
    lobby.mode = 'friends';
    lobby.showPeople();
  }

  function goHome(): void {
    lobby.showHome();
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
    lobby.mode = 'rooms';
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
    notifications.open = false;
    openRoomMessage(item.roomId, item.sourceMessageId);
  }
</script>

{#snippet voiceHome()}
  <VoiceHome
    rooms={rooms.list}
    onOpenRoom={previewRoom}
    onCreateRoom={() => (createDialogOpen = true)}
    onJoinCode={handleJoin}
    onRoomsChanged={rooms.refresh}
    onOpenRoomSettings={(roomId) => (previewSettingsRoomId = roomId)}
    recoveryCodesReminder={prompts.recoveryCodesReminder}
    onOpenRecoveryCodes={() => prompts.openSecuritySettings('recovery-codes')}
    onSnoozeRecoveryCodes={prompts.snoozeRecoveryCodes}
    {onToast}
  />
{/snippet}

{#if user}
  <div class="lobby-shell lv dens-cozy">
    <Sidebar
      {user}
      onGoHome={goHome}
      onOpenPeople={openPeople}
      onOpenSettings={prompts.openSettings}
      notificationsOpen={notifications.open}
      notificationUnreadCount={notifications.inbox.unreadCount}
      onOpenNotifications={notifications.toggle}
      {onToast}
      activeVoiceRoomId={connectedVoiceRoomId}
      activeVoiceRoomName={connectedVoiceRoomName}
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
            <RoomPage {embeddedRoomId} autoJoin={autoJoinRoomId === embeddedRoomId} />
          {/key}
        </div>
      {/if}

      {#if lobby.mode === 'rooms' && selectedRoom && connectedVoiceRoomId && selectedRoom.roomId !== connectedVoiceRoomId}
        <RoomBrowseView
          {user}
          room={selectedRoom}
          onEnter={() => requestEnterRoom(selectedRoom.roomId)}
          onBack={closeViewedRoom}
          onOpenSettings={selectedRoom.relationship === 'owner'
            ? () => (previewSettingsRoomId = selectedRoom.roomId)
            : undefined}
          onRoomsChanged={() => {
            closeViewedRoom();
            void rooms.refresh();
          }}
          {onToast}
        />
      {:else if lobby.mode === 'rooms' && selectedRoom && (!embeddedRoomId || !embeddedRoomVisible)}
        {@const anchor = previewAnchor?.roomId === selectedRoom.roomId ? previewAnchor : null}
        <!-- Keyed on the anchor so a second mention in a room already on screen
             still reopens its chat on the new message. -->
        {#key anchor?.messageId ?? ''}
          <RoomPreviewView
            {user}
            room={selectedRoom}
            initialPanel={anchor ? 'chat' : null}
            aroundMessageId={anchor?.messageId}
            onEnter={() => requestEnterRoom(selectedRoom.roomId)}
            onBack={closeViewedRoom}
            onOpenSettings={selectedRoom.relationship === 'owner'
              ? () => (previewSettingsRoomId = selectedRoom.roomId)
              : undefined}
            onRoomsChanged={() => {
              closeViewedRoom();
              void rooms.refresh();
            }}
            {onToast}
          />
        {/key}
      {:else if lobby.mode === 'rooms' && !embeddedRoomVisible}
        {@render voiceHome()}
      {:else if lobby.mode === 'friends' && lobby.view === 'dm'}
        <DmView self={user} />
      {:else if lobby.mode === 'friends' && lobby.view === 'people'}
        <PeopleView {user} {onToast} onHome={goHome} />
      {:else if lobby.mode === 'friends'}
        {@render voiceHome()}
      {/if}
    </main>
  </div>

  <CreateRoomDialog
    open={createDialogOpen}
    {creating}
    onClose={() => (createDialogOpen = false)}
    onCreate={handleCreate}
  />
  <LobbyAccountDialogs
    {prompts}
    {user}
    {notificationUsers}
    notificationRooms={rooms.list}
    {loggingOut}
    {onToast}
    {onLogout}
  />
  <LobbyRoomSettingsDialog
    room={previewSettingsRoom}
    onClose={() => (previewSettingsRoomId = '')}
    onSaved={rooms.refresh}
    onDeleted={() => {
      previewSettingsRoomId = '';
      closeViewedRoom();
      void rooms.refresh();
    }}
    {onToast}
  />
  <RoomSwitchDialog
    open={Boolean(pendingRoomSwitchId)}
    fromName={connectedVoiceRoomName}
    toName={rooms.label(pendingRoomSwitchId)}
    onConfirm={(dontAskAgain) => resolveRoomSwitch(true, dontAskAgain)}
    onCancel={() => resolveRoomSwitch(false)}
  />
  <ProfileCardHost {onToast} />
  {#if openInAppRoomId}
    <OpenInAppScreen onRetry={openRoomInApp} onContinue={continueRoomInBrowser} />
  {/if}
  {#if notifications.open}
    <aside class="notification-inbox-panel" aria-label="Панель уведомлений">
      <NotificationInbox
        inbox={notifications.inbox}
        onopen={openNotification}
        onclose={() => (notifications.open = false)}
      />
    </aside>
  {/if}
{/if}

<style>
  /* The panel clips; the list inside it is what scrolls. */
  .notification-inbox-panel {
    position: fixed;
    z-index: 71;
    left: 326px;
    bottom: 16px;
    display: flex;
    width: min(420px, calc(100vw - 358px));
    max-height: min(620px, calc(100vh - 32px));
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--paper);
    box-shadow: var(--shadow);
  }
  .notification-inbox-panel :global(.notification-inbox) {
    flex: 1 1 auto;
    min-width: 0;
  }
  @media (max-width: 900px) {
    .notification-inbox-panel {
      left: 12px;
      right: 12px;
      bottom: 76px;
      width: auto;
      max-height: min(560px, calc(100vh - 96px));
    }
  }
  :global(.lobby-main) {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  :global(.lobby-embedded-room) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  :where(.lobby-embedded-room)[hidden] {
    display: none;
  }
  :global(.lv-main) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
