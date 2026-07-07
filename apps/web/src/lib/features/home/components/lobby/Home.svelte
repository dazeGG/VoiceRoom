<script lang="ts">
  import { AvatarStack, Ellipsis } from '$lib/shared/ui';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { roomPresence } from '../../model/room-presence.svelte';
  import { roomPeerAvatarItems } from '../../model/room-avatars';
  import { roomDisplayName, roomVisual } from '../../model/rooms';
  import { friendsState, showPeople } from '../../model/friends.svelte';

  let { user, rooms, onOpenRoom, onCreateRoom, onJoinCode, onAddRoom } = $props<{
    user: AuthUser;
    rooms: OwnedRoom[];
    onOpenRoom: (roomId: string) => void;
    onCreateRoom: () => void;
    onJoinCode: (code: string) => void;
    onAddRoom: () => void;
  }>();

  let joinCode = $state('');

  const selfName = $derived(user.displayName?.trim() || user.login);
  const requestCount = $derived(friendsState.incomingRequestCount);
  const sortedRooms = $derived([...rooms].sort((a: OwnedRoom, b: OwnedRoom) => b.peers - a.peers));

  function roomAvatars(roomId: string) {
    return roomPeerAvatarItems(roomPresence.peersByRoomId[roomId] || []);
  }

  function submitJoinCode(event: Event): void {
    event.preventDefault();
    if (!joinCode.trim()) return;
    onJoinCode(joinCode);
    joinCode = '';
  }
</script>

<div class="lobby-page lobby-scroll">
  <div class="lobby-page-inner">
    <div class="lobby-greeting">С возвращением,</div>
    <div class="lobby-title">{selfName} 👋</div>

    {#if requestCount > 0}
      <button class="lobby-callout" type="button" onclick={showPeople}>
        <span class="lobby-callout-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
        </span>
        <div style="flex:1;min-width:0;">
          <div class="lobby-callout-title">{requestCount} {requestCount === 1 ? 'новая заявка' : 'новые заявки'} в друзья</div>
          <div class="lobby-callout-sub">Откройте, чтобы принять или отклонить</div>
        </div>
        <span style="flex:none;color:#7d7768;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </span>
      </button>
    {/if}

    <div class="lobby-rooms-head">
      <h2 class="lobby-title" style="margin:0;font-size:22px;">Комнаты</h2>
      <div class="lobby-rooms-head-actions">
        <form class="lobby-search lobby-join-code" onsubmit={submitJoinCode}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
          <input
            type="text"
            placeholder="Войти по коду"
            style="font-family:var(--font-mono);font-size:12.5px;"
            bind:value={joinCode}
          />
          <button type="submit" class="lobby-join-code-button">Войти</button>
        </form>
        <button class="lobby-primary lobby-primary--inline" type="button" onclick={onCreateRoom}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Создать комнату
        </button>
      </div>
    </div>

    <div class="lobby-list-head lobby-list-head--row" style="padding:0 0 12px;">
      <span class="lobby-mono">Мои комнаты</span>
      <button class="lobby-icon-btn" type="button" title="Добавить комнату по коду" onclick={onAddRoom}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
    </div>

    {#if rooms.length === 0}
      <p class="lobby-empty">У вас пока нет комнат — создайте первую кнопкой выше.</p>
    {:else}
      <div class="lobby-grid-cards">
        {#each sortedRooms as room (room.roomId)}
          {@const visual = roomVisual(room)}
          <button class="lobby-room-card" type="button" onclick={() => onOpenRoom(room.roomId)}>
            <div class="lobby-room-card-head">
              <span class="lobby-tile" style={`width:42px;height:42px;font-size:20px;background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`}>{visual.emoji}</span>
              <div style="min-width:0;flex:1;">
                <Ellipsis text={roomDisplayName(room)} class="lobby-room-card-name" tag="div" />
              </div>
            </div>
            <div class="lobby-room-card-foot">
              {#if room.peers > 0}
                <span class="lobby-voices"><span class="lobby-live-dot"></span><AvatarStack items={roomAvatars(room.roomId)} maxAvatars={5} size={24} ariaLabel="В комнате" /></span>
              {:else}
                <span class="lobby-row-sub lobby-row-sub--muted">тихо сейчас</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
