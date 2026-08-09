<script lang="ts">
  import { MessageSquare, Users } from '@lucide/svelte';
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { RoomInviteFriendList, RoomMenu } from '$lib/shared/components/room-menu';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { getConnectionStatusView } from '../client/ui/status';
  import { closeChat, roomUi, selectRoomPanel, type RoomPanelTab } from '../room-ui.svelte';
  import { roomSettingsUi, openRoomSettings } from '../room-settings.svelte';
  import { showToast } from '../client/ui/toast';
  import { friendsState } from '$lib/features/home/model/friends.svelte';
  import { getSortedParticipants } from '../participants-ui.svelte';
  import { markRoomChatRead } from '$lib/api/rooms';
  import { roomPresence, setRoomUnreadCount } from '$lib/features/home/model/room-presence.svelte';
  import RoomCallTimer from './RoomCallTimer.svelte';

  const connection = $derived(getConnectionStatusView());

  // Heading content is derived from the reactive room state — the vanilla client
  // populates roomClientState.room* on join/rename, and these update without imperative DOM writes.
  const heading = $derived(roomClientState.roomName || roomClientState.roomId);
  const roomAccountIds = $derived(
    new Set(getSortedParticipants().map((participant) => participant.accountUserId).filter(Boolean))
  );
  const roomUnreadCount = $derived(Math.max(roomUi.unreadChat, roomPresence.unreadCountByRoomId[roomClientState.roomId] ?? 0));

  function openRoomPanel(tab: RoomPanelTab): void {
    if (roomUi.chatOpen && roomUi.activePanel === tab) {
      closeChat();
      return;
    }
    selectRoomPanel(tab);
    if (tab !== 'chat') return;
    setRoomUnreadCount(roomClientState.roomId, 0);
    if (roomClientState.self?.accountUserId) void markRoomChatRead(roomClientState.roomId).catch(() => {});
  }

  function notifyRoomsChanged(): void {
    window.dispatchEvent(new CustomEvent('voice-room:rooms-changed', { detail: { roomId: roomClientState.roomId } }));
  }

</script>

<Topbar label="Новая голосовая комната" reload>
  <div class="room-heading topbar-room-heading" aria-label="Комната" hidden={roomClientState.screen !== 'room'}>
    <div class="room-heading-main">
      {#snippet roomInviteContent(close: () => void)}
        <RoomInviteFriendList
          friends={friendsState.friends}
          roomId={roomClientState.roomId}
          presentUserIds={roomAccountIds}
          {close}
          onToast={showToast}
        />
      {/snippet}
      <RoomMenu
        roomId={roomClientState.roomId}
        name={heading}
        avatarUrl={roomClientState.roomAvatarUrl}
        avatarSize={38}
        triggerClass="room-heading-trigger"
        titleClass="room-heading-title"
        chevronClass="room-heading-trigger-chevron"
        heading
        headingClass="room-heading-title-wrap"
        keepContentMounted
        relationship={roomSettingsUi.isOwner ? 'owner' : 'bookmarked'}
        onOpenSettings={roomSettingsUi.isOwner ? openRoomSettings : undefined}
        onRoomsChanged={notifyRoomsChanged}
        inviteContent={roomClientState.self?.accountUserId ? roomInviteContent : undefined}
        onToast={showToast}
        showNotificationControls={Boolean(roomClientState.self?.accountUserId)}
      />
    </div>

    <div class="room-heading-actions">
      <RoomCallTimer />
      <div class="room-panel-tabs room-panel-tabs--topbar" role="group" aria-label="Открыть раздел панели комнаты">
        <button
          type="button"
          aria-label="Чат"
          aria-pressed={roomUi.chatOpen && roomUi.activePanel === 'chat'}
          data-active={roomUi.chatOpen && roomUi.activePanel === 'chat'}
          title="Чат"
          onclick={() => openRoomPanel('chat')}
        >
          <MessageSquare {...iconSm} aria-hidden="true" />
          {#if roomUnreadCount > 0}<span class="room-panel-tab-unread" aria-hidden="true"></span>{/if}
        </button>
        <button
          type="button"
          aria-label="Участники"
          aria-pressed={roomUi.chatOpen && roomUi.activePanel === 'participants'}
          data-active={roomUi.chatOpen && roomUi.activePanel === 'participants'}
          title="Участники"
          onclick={() => openRoomPanel('participants')}
        >
          <Users {...iconSm} aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>

  <div
    class="status-pill"
    data-state={connection.stateName}
    title={connection.title || undefined}
    hidden={connection.stateName === 'idle' || roomClientState.screen !== 'room'}
  >
    <span class="status-dot" aria-hidden="true"></span>
    <span>{connection.label}</span>
  </div>
</Topbar>

<style>
  .room-heading-actions { display: flex; flex: none; align-items: center; gap: 12px; }
</style>
