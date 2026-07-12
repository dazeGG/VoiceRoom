<script lang="ts">
  import { MessageSquare, Settings, UserRoundPlus } from '@lucide/svelte';
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import { iconMd } from '$lib/shared/ui/icons';
  import { Avatar, Popover } from '$lib/shared/ui';
  import { RoomMenu } from '$lib/shared/components/room-menu';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { getConnectionStatusView } from '../client/ui/status';
  import { roomUi, toggleChat } from '../room-ui.svelte';
  import { roomSettingsUi, openRoomSettings } from '../room-settings.svelte';
  import { showToast } from '../client/ui/toast';
  import { friendsState } from '$lib/features/home/model/friends.svelte';
  import { ringRoomFriend } from '$lib/api/rooms';

  const connection = $derived(getConnectionStatusView());

  // Heading content is derived from the reactive room state — the vanilla client
  // populates roomClientState.room* on join/rename, and these update without imperative DOM writes.
  const heading = $derived(roomClientState.roomName || roomClientState.roomId);
  let ringingUserId = $state('');
  const ringFriends = $derived([...friendsState.friends].sort((a, b) => Number(b.online) - Number(a.online)));

  function handleOpenSettings(): void {
    openRoomSettings();
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
        onToast={showToast}
      />
    </div>

    {#if roomSettingsUi.isOwner}
      <button class="room-chat-toggle" type="button" title="Настройки комнаты" onclick={handleOpenSettings}>
        <Settings {...iconMd} aria-hidden="true" />
        <span>Настройки</span>
      </button>
    {/if}

    {#if roomClientState.self?.accountUserId}
      <Popover placement="bottom-end" role="menu" ariaLabel="Позвать друга">
        {#snippet trigger({ open, toggle, panelId })}
          <button class="room-chat-toggle" type="button" aria-expanded={open} aria-controls={panelId} onclick={toggle}>
            <UserRoundPlus {...iconMd} aria-hidden="true" />
            <span>Позвать</span>
          </button>
        {/snippet}
        {#snippet content({ close })}
          <div class="room-ring-list">
            {#if ringFriends.length === 0}
              <span class="room-ring-empty">Добавьте друзей, чтобы позвать их</span>
            {:else}
              {#each ringFriends as friend (friend.user.id)}
                <button type="button" class="room-ring-friend" disabled={Boolean(ringingUserId)} onclick={() => void ringFriend(friend.user.id, close)}>
                  <Avatar name={friend.user.displayName || friend.user.login} src={friend.user.avatarUrl} background={friend.user.avatarAccent || undefined} colorKey={friend.user.avatarColorKey} size={28} online={friend.online} showDot />
                  <span>{friend.user.displayName || friend.user.login}</span>
                </button>
              {/each}
            {/if}
          </div>
        {/snippet}
      </Popover>
    {/if}

    <button
      class="room-chat-toggle"
      type="button"
      aria-pressed={roomUi.chatOpen}
      data-active={roomUi.chatOpen}
      onclick={toggleChat}
      hidden={roomUi.chatOpen}
    >
      <MessageSquare {...iconMd} aria-hidden="true" />
      <span>Чат</span>
      {#if roomUi.unreadChat > 0}
        <span class="room-chat-unread" aria-label={`${roomUi.unreadChat} новых сообщений`}>{roomUi.unreadChat > 99 ? '99+' : roomUi.unreadChat}</span>
      {/if}
    </button>
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
  .room-ring-friend:hover { background: rgba(255, 255, 255, 0.07); }
  .room-ring-friend:disabled { opacity: 0.55; cursor: wait; }
  .room-ring-empty { max-width: 230px; padding: 10px; color: var(--warm-faint); font-size: 13px; }
</style>
