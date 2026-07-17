<script lang="ts">
  import { MessageSquare } from '@lucide/svelte';
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import { iconMd } from '$lib/shared/ui/icons';
  import { Avatar } from '$lib/shared/ui';
  import { effectivePresenceStatus } from '$lib/shared/presence';
  import { RoomMenu } from '$lib/shared/components/room-menu';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { getConnectionStatusView } from '../client/ui/status';
  import { roomUi, toggleChat } from '../room-ui.svelte';
  import { roomSettingsUi, openRoomSettings } from '../room-settings.svelte';
  import { showToast } from '../client/ui/toast';
  import { friendsState } from '$lib/features/home/model/friends.svelte';
  import { getSortedParticipants } from '../participants-ui.svelte';
  import { markRoomChatRead, ringRoomFriend } from '$lib/api/rooms';
  import { notificationPreferences } from '$lib/shared/notifications/preferences.svelte';
  import { roomPresence, setRoomUnreadCount } from '$lib/features/home/model/room-presence.svelte';
  import RoomCallTimer from './RoomCallTimer.svelte';

  const connection = $derived(getConnectionStatusView());

  // Heading content is derived from the reactive room state — the vanilla client
  // populates roomClientState.room* on join/rename, and these update without imperative DOM writes.
  const heading = $derived(roomClientState.roomName || roomClientState.roomId);
  let ringingUserId = $state('');
  const ringFriends = $derived([...friendsState.friends].sort((a, b) => Number(b.online) - Number(a.online)));
  const roomAccountIds = $derived(new Set(getSortedParticipants().map((participant) => participant.accountUserId).filter(Boolean)));
  const roomNotificationsMuted = $derived(notificationPreferences.mutedRoomIds.includes(roomClientState.roomId));
  const roomUnreadCount = $derived(Math.max(roomUi.unreadChat, roomPresence.unreadCountByRoomId[roomClientState.roomId] ?? 0));

  function openRoomChat(): void {
    toggleChat();
    if (!roomUi.chatOpen) return;
    setRoomUnreadCount(roomClientState.roomId, 0);
    if (roomClientState.self?.accountUserId) void markRoomChatRead(roomClientState.roomId).catch(() => {});
  }

  async function ringFriend(userId: string, close: () => void): Promise<void> {
    if (ringingUserId) return;
    ringingUserId = userId;
    try {
      await ringRoomFriend(roomClientState.roomId, userId);
      showToast('Приглашение отправлено');
      close();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось отправить приглашение');
    } finally {
      ringingUserId = '';
    }
  }
</script>

<Topbar label="Новая голосовая комната" reload>
  <div class="room-heading topbar-room-heading" aria-label="Комната" hidden={roomClientState.screen !== 'room'}>
    <div class="room-heading-main">
      {#snippet roomInviteContent(close: () => void)}
        <div class="room-ring-list">
          {#if ringFriends.length === 0}
            <span class="room-ring-empty">Добавьте друзей, чтобы позвать их</span>
          {:else}
            {#each ringFriends as friend (friend.user.id)}
              {@const alreadyInRoom = roomAccountIds.has(friend.user.id)}
              {@const presence = effectivePresenceStatus(friend.online, friend.user.presenceStatus, friend.user.doNotDisturb)}
              <button type="button" class="room-ring-friend" disabled={Boolean(ringingUserId) || alreadyInRoom} title={alreadyInRoom ? 'Уже в комнате' : undefined} onclick={() => void ringFriend(friend.user.id, close)}>
                <Avatar
                  name={friend.user.displayName || friend.user.login}
                  src={friend.user.avatarUrl}
                  background={friend.user.avatarAccent || undefined}
                  colorKey={friend.user.avatarColorKey}
                  size={28}
                  online={presence === 'online'}
                  afk={presence === 'away'}
                  dnd={presence === 'dnd'}
                  showDot
                />
                <span>{friend.user.displayName || friend.user.login}</span>
                {#if alreadyInRoom}<small>В комнате</small>{/if}
              </button>
            {/each}
          {/if}
        </div>
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
        onOpenSettings={roomSettingsUi.isOwner ? openRoomSettings : undefined}
        inviteContent={roomClientState.self?.accountUserId ? roomInviteContent : undefined}
        onToast={showToast}
        showNotificationControls={Boolean(roomClientState.self?.accountUserId)}
      />
    </div>

    <div class="room-heading-actions">
      <RoomCallTimer />
      <button
        class="room-chat-toggle"
        type="button"
        aria-pressed={roomUi.chatOpen}
        data-active={roomUi.chatOpen}
        onclick={openRoomChat}
        hidden={roomUi.chatOpen}
      >
        <MessageSquare {...iconMd} aria-hidden="true" />
        <span>Чат</span>
        {#if roomUnreadCount > 0}
          <span class="room-chat-unread" data-muted={roomNotificationsMuted} aria-label={`${roomUnreadCount} новых сообщений`}>{roomUnreadCount > 99 ? '99+' : roomUnreadCount}</span>
        {/if}
      </button>
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
  .room-ring-list { display: flex; min-width: 220px; max-height: 280px; flex-direction: column; gap: 4px; overflow-y: auto; padding: 6px; }
  .room-ring-friend { display: flex; align-items: center; gap: 9px; border: 0; border-radius: 8px; padding: 7px 8px; background: transparent; color: var(--warm-ink); cursor: pointer; text-align: left; }
  .room-ring-friend:hover { background: var(--control); }
  .room-ring-friend:disabled { opacity: 0.48; cursor: not-allowed; }
  .room-ring-friend small { margin-left: auto; color: var(--warm-faint); font-size: 10px; }
  .room-ring-empty { max-width: 230px; padding: 10px; color: var(--warm-faint); font-size: 13px; }
  .room-heading-actions { display: flex; flex: none; align-items: center; gap: 12px; }
</style>
