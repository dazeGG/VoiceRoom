<script lang="ts">
  import type { OwnedRoom } from '$lib/api/auth';
  import { roomDisplayName, roomVisual } from '../model/rooms';

  let { room, onOpen } = $props<{
    room: OwnedRoom;
    onOpen: (roomId: string) => void;
  }>();

  const label = $derived(roomDisplayName(room));
  const visual = $derived(roomVisual(room));
  const live = $derived(room.peers > 0);
</script>

<article class="room-card">
  <div class="room-card-head">
    <div class="room-card-id">
      <span class="room-card-emoji" style={`background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`} aria-hidden="true">{visual.emoji}</span>
      <div class="room-card-meta">
        <div class="room-card-name" title={label}>{label}</div>
        <div class="room-card-code">{room.roomId}</div>
      </div>
    </div>
    {#if room.relationship === 'bookmarked'}
      <span class="room-card-temp room-card-temp--bookmark" title="Добавлена по коду">
        Сохранена
      </span>
    {:else if !room.isStatic}
      <span class="room-card-temp" title="Живёт ещё сутки после того, как опустеет">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>
        Временная
      </span>
    {/if}
  </div>

  <div class="room-card-foot">
    {#if live}
      <span class="room-card-presence room-card-presence--live">
        <span class="room-card-pulse" aria-hidden="true"></span>
        {room.peers} в эфире
      </span>
    {:else}
      <span class="room-card-presence">
        <span class="room-card-dot" aria-hidden="true"></span>
        Пусто сейчас
      </span>
    {/if}
    <button class="room-card-enter" type="button" onclick={() => onOpen(room.roomId)}>Войти</button>
  </div>
</article>
