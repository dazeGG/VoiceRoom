<script lang="ts">
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { roomDisplayName, roomVisual } from '../../model/rooms';
  import { friendName } from '../../model/lobby-format';
  import { friendsState, openDm, setMode, showRequests } from '../../model/friends.svelte';
  import Avatar from './Avatar.svelte';

  let { user, rooms, onOpenRoom } = $props<{
    user: AuthUser;
    rooms: OwnedRoom[];
    onOpenRoom: (roomId: string) => void;
  }>();

  const selfName = $derived(user.displayName?.trim() || user.login);
  const onlineFriends = $derived(friendsState.friends.filter((entry) => entry.online));
  const liveRooms = $derived(rooms.filter((room: OwnedRoom) => room.peers > 0));
  const requestCount = $derived(friendsState.incomingRequestCount);
</script>

<div class="lobby-page lobby-scroll">
  <div class="lobby-page-inner">
    <div class="lobby-greeting">С возвращением,</div>
    <div class="lobby-title">{selfName} 👋</div>

    {#if requestCount > 0}
      <button class="lobby-callout" type="button" onclick={showRequests}>
        <span class="lobby-callout-icon">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
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

    <div class="lobby-section-head">
      <div class="lobby-mono">Друзья онлайн</div>
      <div class="lobby-section-meta">{onlineFriends.length} в сети</div>
    </div>
    {#if onlineFriends.length === 0}
      <p class="lobby-empty">Сейчас никого нет в сети.</p>
    {:else}
      <div class="lobby-grid-3">
        {#each onlineFriends as entry (entry.user.id)}
          <button class="lobby-friend-card" type="button" onclick={() => openDm(entry.user.id)}>
            {#if entry.unreadCount > 0}
              <span class="lobby-badge lobby-badge--sm lobby-friend-card-badge">{entry.unreadCount}</span>
            {/if}
            <Avatar name={friendName(entry.user)} colorKey={entry.user.avatarColorKey} size={54} online showDot ring="#14110c" />
            <div class="lobby-friend-card-name" style="margin-top:12px;">{friendName(entry.user)}</div>
            <div class="lobby-friend-card-status">в сети</div>
            <div class="lobby-friend-card-action">Написать</div>
          </button>
        {/each}
      </div>
    {/if}

    <div class="lobby-section-head">
      <div class="lobby-mono">Сейчас в комнатах</div>
      <button class="lobby-section-link" type="button" onclick={() => setMode('rooms')}>все комнаты →</button>
    </div>
    {#if liveRooms.length === 0}
      <p class="lobby-empty">Пока никто не разговаривает. Создайте комнату во вкладке «Комнаты».</p>
    {:else}
      <div class="lobby-grid-3">
        {#each liveRooms as room (room.roomId)}
          {@const visual = roomVisual(room)}
          <button class="lobby-room-card" type="button" onclick={() => onOpenRoom(room.roomId)}>
            <div class="lobby-room-card-head">
              <span class="lobby-tile" style={`width:46px;height:46px;font-size:23px;background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`}>{visual.emoji}</span>
              <div style="min-width:0;flex:1;">
                <div class="lobby-room-card-name">{roomDisplayName(room)}</div>
                <div class="lobby-room-card-meta">{room.peers} в эфире</div>
              </div>
            </div>
            <div class="lobby-room-card-foot">
              <span class="lobby-voices"><span class="lobby-live-dot"></span><span class="lobby-room-card-meta" style="margin-top:0;">в разговоре</span></span>
              <span class="lobby-room-enter">Войти<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17l5-5-5-5"></path><path d="M20 12H9"></path><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"></path></svg></span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
