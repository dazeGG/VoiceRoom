<script lang="ts">
  import type { OwnedRoom } from '$lib/api/auth';
  import { roomDisplayName, roomVisual } from '../../model/rooms';

  let { rooms, onCreateRoom, onOpenRoom } = $props<{
    rooms: OwnedRoom[];
    onCreateRoom: () => void;
    onOpenRoom: (roomId: string) => void;
  }>();

  const liveRooms = $derived(rooms.filter((room: OwnedRoom) => room.peers > 0));
  const idleRooms = $derived(rooms.filter((room: OwnedRoom) => room.peers === 0));
</script>

<div class="lobby-page lobby-scroll">
  <div class="lobby-page-inner">
    <div class="lobby-greeting">Ваши</div>
    <div class="lobby-title">Комнаты</div>

    {#if rooms.length === 0}
      <p class="lobby-empty" style="margin-top:26px;">У вас пока нет комнат. Создайте новую кнопкой ниже.</p>
      <div style="max-width:260px;margin-top:16px;">
        <button class="lobby-primary" type="button" onclick={onCreateRoom}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Создать комнату
        </button>
      </div>
    {:else}
      {#if liveRooms.length > 0}
        <div class="lobby-section-head" style="margin-top:30px;">
          <div class="lobby-mono">Сейчас идёт разговор</div>
          <div class="lobby-section-meta">{liveRooms.length} активн{liveRooms.length === 1 ? 'а' : 'ы'}</div>
        </div>
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

      {#if idleRooms.length > 0}
        <div class="lobby-mono" style="font-size:11px;color:#7d7768;margin:34px 0 16px;">Остальные комнаты</div>
        <div class="lobby-grid-2">
          {#each idleRooms as room (room.roomId)}
            {@const visual = roomVisual(room)}
            <button class="lobby-room-row" type="button" onclick={() => onOpenRoom(room.roomId)}>
              <span class="lobby-tile" style={`width:42px;height:42px;font-size:21px;background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`}>{visual.emoji}</span>
              <div style="flex:1;min-width:0;">
                <div class="lobby-room-card-name">{roomDisplayName(room)}</div>
                <div class="lobby-row-sub lobby-row-sub--muted">тихо сейчас</div>
              </div>
              <span style="flex:none;color:#7d7768;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>
