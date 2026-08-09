<script lang="ts">
  import { BellOff, ChevronRight, Plus, UserPlus } from '@lucide/svelte';
  import { Avatar, AvatarStack, Badge, Button, ContextMenu, Ellipsis, MascotIcon } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import type { OwnedRoom } from '$lib/api/auth';
  import { roomPresence } from '../../model/room-presence.svelte';
  import { roomPeerAvatarItems } from '../../model/room-avatars';
  import { roomDisplayName } from '../../model/rooms';
  import { friendsState, showPeople } from '../../model/friends.svelte';
  import { notificationPreferences } from '$lib/shared/notifications/preferences.svelte';
  import { RoomMenuContent } from '$lib/shared/components/room-menu';

  let { rooms, onOpenRoom, onCreateRoom, onJoinCode, onRoomsChanged, onOpenRoomSettings, onToast } = $props<{
    rooms: OwnedRoom[];
    onOpenRoom: (roomId: string) => void;
    onCreateRoom: () => void;
    onJoinCode: (code: string) => void;
    onRoomsChanged?: () => void;
    onOpenRoomSettings?: (roomId: string) => void;
    onToast?: (message: string) => void;
  }>();

  let joinCode = $state('');
  let contextRoomId = $state('');
  let contextX = $state(0);
  let contextY = $state(0);
  let contextTrigger = $state<HTMLElement | null>(null);

  const requestCount = $derived(friendsState.incomingRequestCount);
  const sortedRooms = $derived([...rooms].sort((a: OwnedRoom, b: OwnedRoom) => b.peers - a.peers));
  const contextRoom = $derived(rooms.find((room: OwnedRoom) => room.roomId === contextRoomId));

  function roomAvatars(roomId: string) {
    return roomPeerAvatarItems(roomPresence.peersByRoomId[roomId] || []);
  }

  // Friends already in the room render disabled in the invite submenu.
  function roomPresentUserIds(roomId: string): Set<string> {
    const peers = roomPresence.peersByRoomId[roomId] || [];
    return new Set(
      peers
        .map((peer: { accountUserId?: string }) => peer.accountUserId || '')
        .filter((userId: string) => userId !== '')
    );
  }

  function roomUnreadCount(room: OwnedRoom): number {
    return roomPresence.unreadCountByRoomId[room.roomId] ?? room.unreadCount ?? 0;
  }

  function submitJoinCode(event: Event): void {
    event.preventDefault();
    if (!joinCode.trim()) return;
    onJoinCode(joinCode);
    joinCode = '';
  }

  function openRoomContextMenu(event: MouseEvent, roomId: string): void {
    event.preventDefault();
    event.stopPropagation();
    contextRoomId = roomId;
    contextX = event.clientX;
    contextY = event.clientY;
    contextTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  }

  function handleRoomKeydown(event: KeyboardEvent, roomId: string): void {
    const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!isContextKey || !(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    contextRoomId = roomId;
    contextX = rect.left + Math.min(rect.width - 12, 56);
    contextY = rect.top + Math.min(rect.height - 8, 44);
    contextTrigger = event.currentTarget;
  }

  function closeRoomContextMenu(): void {
    contextRoomId = '';
  }
</script>

<div class="lv-main-scroll">
  <h1 class="lr-title">Комнаты</h1>

  {#if requestCount > 0}
    <button class="lr-callout" type="button" onclick={showPeople}>
      <span class="lr-callout-icon">
        <UserPlus {...iconMd} aria-hidden="true" />
      </span>
      <div style="flex:1;min-width:0;">
        <div class="lr-callout-title">{requestCount} {requestCount === 1 ? 'новая заявка' : 'новые заявки'} в друзья</div>
        <div class="lr-callout-sub">Откройте, чтобы принять или отклонить</div>
      </div>
      <span style="flex:none;color:var(--warm-faint);">
        <ChevronRight {...iconMd} aria-hidden="true" />
      </span>
    </button>
  {/if}

  <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin:24px 0 18px;">
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
      <form class="lv-join" onsubmit={submitJoinCode} aria-describedby="roomAutoSaveHint">
        <input class="lv-join-input" placeholder="Код или ссылка" bind:value={joinCode} />
        <span
          class="lv-join-hint"
          title="Постоянные комнаты сохраняются автоматически"
          aria-hidden="true"
        >i</span>
        <span class="lv-sr-only" id="roomAutoSaveHint">Постоянные комнаты сохраняются автоматически</span>
        <button class="lv-join-btn" type="submit">Войти</button>
      </form>
      <Button variant="primary" onclick={onCreateRoom}>
        {#snippet icon()}<Plus {...iconSm} aria-hidden="true" />{/snippet}
        Создать комнату
      </Button>
    </div>
  </div>

  {#if rooms.length === 0}
    <div class="lr-empty-state">
      <MascotIcon variant="blink" size={32} />
      <p class="lr-empty">У вас пока нет комнат — создайте первую кнопкой выше.</p>
    </div>
  {:else}
    <div class="lv-cards">
      {#each sortedRooms as room (room.roomId)}
        {@const roomNotificationsMuted = notificationPreferences.mutedRoomIds.includes(room.roomId)}
        {@const unreadCount = roomUnreadCount(room)}
        <button
          class="lv-card"
          class:is-live={room.peers > 0}
          class:is-context={contextRoomId === room.roomId}
          type="button"
          onclick={() => onOpenRoom(room.roomId)}
          oncontextmenu={(event) => openRoomContextMenu(event, room.roomId)}
          onkeydown={(event) => handleRoomKeydown(event, room.roomId)}
          aria-haspopup="menu"
          class:has-unread={unreadCount > 0}
        >
          <div class="lv-card-head">
            <Avatar name={roomDisplayName(room)} src={room.avatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={42} />
            <div style="min-width:0;flex:1;">
              <div class="lv-notification-title">
                <Ellipsis text={roomDisplayName(room)} class="lv-row-name" tag="div" />
                {#if roomNotificationsMuted}
                  <span class="lv-notification-muted" role="img" aria-label="Уведомления отключены" title="Уведомления отключены">
                    <BellOff {...iconSm} aria-hidden="true" />
                  </span>
                {/if}
              </div>
            </div>
          </div>
          {#if unreadCount > 0}
            <Badge class="lv-card-unread" tone={roomNotificationsMuted ? 'muted' : 'default'}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          {/if}
          <div class="lv-card-foot">
            {#if room.peers > 0}
              <span style="display:flex;align-items:center;gap:8px;"><span class="lr-livedot"></span><AvatarStack items={roomAvatars(room.roomId)} maxAvatars={5} size={24} ariaLabel="В комнате" /></span>
            {:else}
              <span class="lv-row-sub">тихо сейчас</span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if contextRoom}
  <ContextMenu
    open={Boolean(contextRoomId)}
    x={contextX}
    y={contextY}
    ariaLabel={`Меню комнаты ${roomDisplayName(contextRoom)}`}
    restoreFocus={contextTrigger}
    onClose={closeRoomContextMenu}
  >
    {#snippet content({ close })}
      {#key contextRoom.roomId}
        <RoomMenuContent
          roomId={contextRoom.roomId}
          name={roomDisplayName(contextRoom)}
          avatarUrl={contextRoom.avatarUrl}
          relationship={contextRoom.relationship}
          friends={friendsState.friends}
          presentUserIds={roomPresentUserIds(contextRoom.roomId)}
          {close}
          canClose={(roomId) => contextRoomId === roomId}
          onOpenSettings={contextRoom.relationship === 'owner' ? () => onOpenRoomSettings?.(contextRoom.roomId) : undefined}
          {onRoomsChanged}
          {onToast}
        />
      {/key}
    {/snippet}
  </ContextMenu>
{/if}
