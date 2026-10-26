<script lang="ts">
  import { onMount } from 'svelte';
  import { getAppRealtime } from '$lib/api/realtime';
  import type { AuthUser } from '$lib/api/auth';
  import type { InboxItem } from '@voice-room/shared/contracts/notifications';
  import { createRoom } from '$lib/api/rooms';
  import { extractRoomId } from '$lib/shared/utils/room';
  import RoomPage from '$lib/features/room/RoomPage.svelte';
  import { toggleActiveVoiceMic, toggleActiveVoiceDeafen, voiceSession } from '$lib/features/room/voice-session.svelte';
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
  import { LobbyStore } from './model/lobby.svelte';
  import { LobbyNotifications } from './model/lobby-notifications.svelte';
  import { LobbyRouting } from './model/lobby-routing.svelte';
  import { StaffAccess } from './model/staff-access.svelte';
  import type { ActiveVoice } from './model/active-voice';
  import { syncLobbyWithDesktop } from './model/desktop-sync.svelte';
  import { provideLobby } from './model/lobby-context';
  import { provideRoomSocial } from '$lib/features/room/social';
  import { provideRoomShell } from '$lib/features/room/shell';
  import type { ToastOptions } from './model/toasts.svelte';
  import {
    embeddedRoomIsVisible,
    getActiveVoiceRoomId,
    mountedRoomId,
    roomNavigation
  } from './model/room-navigation.svelte';
  import { roomDisplayName } from './model/rooms';
  import { LobbyRooms } from './model/lobby-rooms.svelte';
  import { AccountPrompts } from './model/account-prompts.svelte';
  import LobbyAccountDialogs from './components/LobbyAccountDialogs.svelte';
  import RoomSwitchDialog from './components/RoomSwitchDialog.svelte';
  import { clearSession, consumeExpectedSessionEnd, session as authSession } from '$lib/features/auth/session.svelte';
  import OpenInAppScreen from './components/OpenInAppScreen.svelte';
  import { roomUi } from '$lib/features/room/room-ui.svelte';
  import { screenUi } from '$lib/features/room/screen-ui.svelte';
  import { syncEmbeddedRoomDocument } from './model/embedded-room-document';
  import { clientRoomName } from '$lib/features/room/client';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/dialog.css';
  import '$lib/features/room/styles/chat-rail.css';
  import './styles/friends.css';
  import '$lib/shared/styles/settings.css';
  import './styles/lobby-v2.css';

  const lobby = new LobbyStore({ onEnterRoom: (roomId) => routing.requestEnterRoom(roomId) });
  provideLobby(lobby);

  // Rooms shown inside the lobby see the account's friends through this.
  provideRoomSocial(lobby.roomSocial);

  let {
    user,
    loggingOut,
    createRoomOnOpen = false,
    onLogout,
    onToast
  } = $props<{
    user: AuthUser;
    loggingOut: boolean;
    /** The account was just made for a permanent room: open the new-room dialog. */
    createRoomOnOpen?: boolean;
    onLogout: () => void;
    onToast: (message: string, options?: ToastOptions) => void;
  }>();

  const rooms = new LobbyRooms((message) => onToast(message));
  const routing = new LobbyRouting(lobby, rooms);
  const staff = new StaffAccess((message, options) => onToast(message, options));
  // What the room shown in the lobby tells it.
  provideRoomShell({
    roomLeft: (roomId) => routing.closeLeftRoom(roomId),
    roomsChanged: () => void rooms.refresh()
  });

  const roomLabel = (roomId: string): string => rooms.label(roomId);
  let creating = $state(false);
  let createDialogOpen = $state(false);
  let previewSettingsRoomId = $state('');
  const notifications = new LobbyNotifications();
  const selectedRoomId = $derived(roomNavigation.viewedRoomId);
  const embeddedRoomId = $derived(mountedRoomId());
  const autoJoinRoomId = $derived(roomNavigation.joinIntentRoomId);
  const connectedVoiceRoomId = $derived(getActiveVoiceRoomId());

  const prompts = new AccountPrompts({
    user: () => user,
    voiceActive: () => Boolean(connectedVoiceRoomId || roomNavigation.joinIntentRoomId),
    lobbyDialogOpen: () => createDialogOpen,
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
      : clientRoomName(connectedVoiceRoomId) || connectedVoiceRoomId || ''
  );
  const activeVoice = $derived<ActiveVoice | null>(
    connectedVoiceRoomId
      ? {
          roomName: connectedVoiceRoomName.trim() || connectedVoiceRoomId,
          avatarUrl: connectedVoiceRoom?.avatarUrl ?? null,
          muted: voiceSession.muted,
          deafened: voiceSession.deafened,
          open: routing.openConnectedVoiceRoom,
          toggleMic: toggleActiveVoiceMic,
          toggleDeafen: toggleActiveVoiceDeafen,
          leave: () => void routing.leaveConnectedVoiceRoom()
        }
      : null
  );
  const notificationUsers = $derived(
    [...lobby.friends]
      .sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0))
      .map((entry) => entry.user)
  );
  const embeddedRoomVisible = $derived(embeddedRoomIsVisible(lobby.mode));

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
    if (createRoomOnOpen) createDialogOpen = true;
    prompts.start();
    const teardownNotifications = notifications.start();
    const teardownFriends = lobby.init(user.id, user.doNotDisturb, user.presenceStatus);
    const teardownRooms = rooms.follow();
    const teardownStaff = staff.start();
    const teardownRouting = routing.start();
    return () => {
      teardownNotifications();
      teardownFriends();
      teardownRooms();
      teardownStaff();
      teardownRouting();
    };
  });

  $effect(() => {
    if (!embeddedRoomId) {
      delete document.body.dataset.lobbyEmbedded;
      return;
    }
    syncEmbeddedRoomDocument(document.body, {
      visible: embeddedRoomVisible,
      chatOpen: roomUi.chatOpen,
      streamOnStage: screenUi.stageVisible
    });
  });

  syncLobbyWithDesktop({
    get userId() {
      return user.id;
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
    onDisconnect: () => void routing.leaveConnectedVoiceRoom()
  });

  function handleJoin(code: string): void {
    const roomId = extractRoomId(code);
    if (!roomId) {
      onToast('Введите код комнаты');
      return;
    }
    routing.requestEnterRoom(roomId);
  }

  async function handleCreate(payload: { name: string; isStatic: boolean }): Promise<void> {
    if (creating) return;
    creating = true;
    try {
      const roomId = await createRoom(payload);
      createDialogOpen = false;
      routing.requestEnterRoom(roomId);
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

  function openNotification(item: InboxItem): void {
    notifications.open = false;
    routing.openRoomMessage(item.roomId, item.sourceMessageId);
  }
</script>

{#snippet voiceHome()}
  <VoiceHome
    rooms={rooms.list}
    onOpenRoom={routing.previewRoom}
    onCreateRoom={() => (createDialogOpen = true)}
    onJoinCode={handleJoin}
    onRoomsChanged={rooms.refresh}
    onOpenRoomSettings={(roomId: string) => (previewSettingsRoomId = roomId)}
    recoveryCodesReminder={prompts.recoveryCodesReminder}
    onOpenRecoveryCodes={() => prompts.openSecuritySettings('recovery-codes')}
    onSnoozeRecoveryCodes={prompts.snoozeRecoveryCodes}
    {onToast}
  />
{/snippet}

<div class="lobby-shell lv dens-cozy">
  <Sidebar
    {user}
    onGoHome={routing.goHome}
    onOpenPeople={openPeople}
    onOpenSettings={prompts.openSettings}
    adminUrl={staff.adminUrl}
    adminBadge={staff.openReports}
    notificationsOpen={notifications.open}
    notificationUnreadCount={notifications.inbox.unreadCount}
    onOpenNotifications={notifications.toggle}
    {onToast}
    {activeVoice}
  />

  <main class="lobby-main lv-main" aria-label="Главная VoiceRoom">
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
        onEnter={() => routing.requestEnterRoom(selectedRoom.roomId)}
        onBack={routing.closeViewedRoom}
        onOpenSettings={selectedRoom.relationship === 'owner'
          ? () => (previewSettingsRoomId = selectedRoom.roomId)
          : undefined}
        onRoomsChanged={() => {
          routing.closeViewedRoom();
          void rooms.refresh();
        }}
        {onToast}
      />
    {:else if lobby.mode === 'rooms' && selectedRoom && (!embeddedRoomId || !embeddedRoomVisible)}
      {@const anchor = routing.previewAnchor?.roomId === selectedRoom.roomId ? routing.previewAnchor : null}
      <!-- Keyed on the anchor so a second mention in a room already on screen
             still reopens its chat on the new message. -->
      {#key anchor?.messageId ?? ''}
        <RoomPreviewView
          {user}
          room={selectedRoom}
          initialPanel={anchor ? 'chat' : null}
          aroundMessageId={anchor?.messageId}
          onEnter={() => routing.requestEnterRoom(selectedRoom.roomId)}
          onBack={routing.closeViewedRoom}
          onOpenSettings={selectedRoom.relationship === 'owner'
            ? () => (previewSettingsRoomId = selectedRoom.roomId)
            : undefined}
          onRoomsChanged={() => {
            routing.closeViewedRoom();
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
      <PeopleView {user} {onToast} onHome={routing.goHome} />
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
    routing.closeViewedRoom();
    void rooms.refresh();
  }}
  {onToast}
/>
<RoomSwitchDialog
  open={Boolean(routing.pendingRoomSwitchId)}
  fromName={connectedVoiceRoomName}
  toName={rooms.label(routing.pendingRoomSwitchId)}
  onConfirm={(dontAskAgain: boolean) => routing.resolveRoomSwitch(true, dontAskAgain)}
  onCancel={() => routing.resolveRoomSwitch(false)}
/>
<ProfileCardHost {onToast} />
{#if routing.openInAppRoomId}
  <OpenInAppScreen onRetry={routing.openRoomInApp} onContinue={routing.continueRoomInBrowser} />
{/if}
{#if notifications.open}
  <aside class="notification-inbox-panel" aria-label="Панель уведомлений">
    <NotificationInbox
      inbox={notifications.inbox}
      onopen={openNotification}
      onclose={() => (notifications.open = false)}
      {roomLabel}
    />
  </aside>
{/if}

<style>
  /* The panel clips; the list inside it is what scrolls. */
  .notification-inbox-panel {
    position: fixed;
    z-index: 71;
    left: 292px;
    bottom: 16px;
    display: flex;
    width: min(420px, calc(100vw - 316px));
    max-height: min(620px, calc(100vh - 32px));
    overflow: hidden;
    border: 1px solid var(--vr-line-strong);
    border-radius: 18px;
    background: var(--vr-surface-2);
    box-shadow: var(--vr-shadow-popover);
    animation: notification-inbox-in 140ms ease-out;
  }
  .notification-inbox-panel :global(.notification-inbox) {
    flex: 1 1 auto;
    min-width: 0;
  }
  @keyframes notification-inbox-in {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: none;
    }
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
