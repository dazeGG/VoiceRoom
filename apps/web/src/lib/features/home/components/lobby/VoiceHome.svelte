<script lang="ts">
  import { ChevronRight, Plus, UserPlus } from '@lucide/svelte';
  import { Avatar, AvatarStack, Button, Ellipsis } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import type { OwnedRoom } from '$lib/api/auth';
  import { roomPresence } from '../../model/room-presence.svelte';
  import { roomPeerAvatarItems } from '../../model/room-avatars';
  import { roomDisplayName } from '../../model/rooms';
  import { friendsState, showPeople } from '../../model/friends.svelte';

  let { rooms, onOpenRoom, onCreateRoom, onJoinCode } = $props<{
    rooms: OwnedRoom[];
    onOpenRoom: (roomId: string) => void;
    onCreateRoom: () => void;
    onJoinCode: (code: string) => void;
  }>();

  let joinCode = $state('');

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
    <p class="lr-empty">У вас пока нет комнат — создайте первую кнопкой выше.</p>
  {:else}
    <div class="lv-cards">
      {#each sortedRooms as room (room.roomId)}
        <button class="lv-card" class:is-live={room.peers > 0} type="button" onclick={() => onOpenRoom(room.roomId)}>
          <div style="display:flex;align-items:center;gap:11px;min-width:0;">
            <Avatar name={roomDisplayName(room)} src={room.avatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={42} />
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
