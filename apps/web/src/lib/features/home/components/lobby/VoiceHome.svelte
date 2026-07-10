<script lang="ts">
  import { AvatarStack, Button, Ellipsis } from '$lib/shared/ui';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { roomPresence } from '../../model/room-presence.svelte';
  import { roomPeerAvatarItems } from '../../model/room-avatars';
  import { roomDisplayName, roomVisual } from '../../model/rooms';
  import { friendsState, showPeople } from '../../model/friends.svelte';

  let { user, rooms, onOpenRoom, onCreateRoom, onJoinCode } = $props<{
    user: AuthUser;
    rooms: OwnedRoom[];
    onOpenRoom: (roomId: string) => void;
    onCreateRoom: () => void;
    onJoinCode: (code: string) => void;
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

<div class="lv-main-scroll">
  <div class="lr-eyebrow">Главная</div>
  <div class="lr-title">С возвращением, {selfName.split(' ')[0]} 👋</div>

  {#if requestCount > 0}
    <button class="lr-callout" type="button" onclick={showPeople}>
      <span class="lr-callout-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
      </span>
      <div style="flex:1;min-width:0;">
        <div class="lr-callout-title">{requestCount} {requestCount === 1 ? 'новая заявка' : 'новые заявки'} в друзья</div>
        <div class="lr-callout-sub">Откройте, чтобы принять или отклонить</div>
      </div>
      <span style="flex:none;color:var(--warm-faint);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </span>
    </button>
  {/if}

  <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin:34px 0 18px;">
    <h2 class="lr-title" style="margin:0;font-size:22px;">Комнаты</h2>
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
        {#snippet icon()}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>{/snippet}
        Создать комнату
      </Button>
    </div>
  </div>

  {#if rooms.length === 0}
    <p class="lr-empty">У вас пока нет комнат — создайте первую кнопкой выше.</p>
  {:else}
    <div class="lv-cards">
      {#each sortedRooms as room (room.roomId)}
        {@const visual = roomVisual(room)}
        <button class="lv-card" class:is-live={room.peers > 0} type="button" onclick={() => onOpenRoom(room.roomId)}>
          <div style="display:flex;align-items:center;gap:11px;min-width:0;">
            <span class="lv-tile" style={`width:42px;height:42px;font-size:20px;background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`}>{visual.emoji}</span>
            <div style="min-width:0;flex:1;">
              <Ellipsis text={roomDisplayName(room)} class="lv-row-name" tag="div" />
            </div>
          </div>
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
