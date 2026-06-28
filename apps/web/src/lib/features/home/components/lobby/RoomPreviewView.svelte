<script lang="ts">
  import { onMount } from 'svelte';
  import type { OwnedRoom } from '$lib/api/auth';
  import { fetchRoomPeers, type RoomPeer } from '$lib/api/rooms';
  import { getAvatarColor } from '$lib/visual/tokens';
  import { roomDisplayName, roomVisual } from '../../model/rooms';
  import { initial } from '../../model/lobby-format';

  let { room, onEnter, onBack } = $props<{
    room: OwnedRoom;
    onEnter: () => void;
    onBack: () => void;
  }>();

  const visual = $derived(roomVisual(room));
  const name = $derived(roomDisplayName(room));

  let peers = $state<RoomPeer[]>([]);
  let loading = $state(true);

  async function refresh(): Promise<void> {
    try {
      peers = await fetchRoomPeers(room.roomId);
    } catch {
      // Keep the last snapshot on a transient failure.
    } finally {
      loading = false;
    }
  }

  // Refetch whenever the previewed room changes (also covers the first load).
  $effect(() => {
    void room.roomId;
    loading = true;
    peers = [];
    void refresh();
  });

  // Light polling keeps the preview close to live without a full SSE join.
  onMount(() => {
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  });

  function peerName(peer: RoomPeer): string {
    return peer.name?.trim() || 'Гость';
  }
</script>

<div class="lobby-roomview">
  <div class="lobby-roomview-top">
    <div class="lobby-roomview-head">
      <button class="lobby-roomview-back" type="button" title="К списку комнат" aria-label="Назад" onclick={onBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <div class="lobby-roomview-id">
        <span class="lobby-roomview-id-tile" style={`background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`}>{visual.emoji}</span>
        <div style="min-width:0;">
          <div class="lobby-roomview-name">{name}</div>
          <div class="lobby-roomview-code">{room.roomId}</div>
        </div>
      </div>
    </div>
    <span class="lobby-roomview-state" data-live={peers.length > 0}>
      {#if peers.length > 0}<span class="lobby-live-dot"></span>{/if}
      {peers.length > 0 ? `${peers.length} в эфире` : 'тихо сейчас'}
    </span>
  </div>

  <div class="lobby-roomview-stage">
    {#if peers.length > 0}
      <div class="lobby-stage-grid lobby-scroll">
        {#each peers as peer (peer.id)}
          <div class="lobby-stage-tile">
            <div class="lobby-stage-avatar" style={`background:${getAvatarColor(peer.avatarColorKey).background}`}>
              {initial(peerName(peer))}
            </div>
            <div class="lobby-stage-name">
              {#if peer.muted}
                <span class="muted" aria-label="микрофон выключен">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="21" y2="21"></line><path d="M9 9v3a3 3 0 0 0 5.1 2.1"></path><path d="M15 11V5a3 3 0 0 0-5.9-.8"></path><path d="M6 11a6 6 0 0 0 9 5.2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                </span>
              {/if}
              <span>{peerName(peer)}</span>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="lobby-stage-empty">
        <div class="lobby-stage-empty-tile" style={`background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`}>{visual.emoji}</div>
        <h2>{loading ? 'Заглядываем в комнату…' : 'В комнате пока пусто'}</h2>
        <p>Зайдите первым и позовите друзей — поделитесь кодом комнаты <strong style="color:#cfc9ba;font-family:var(--font-mono);">{room.roomId}</strong>.</p>
      </div>
    {/if}

    <button class="lobby-roomview-join" type="button" onclick={onEnter}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17l5-5-5-5"></path><path d="M20 12H9"></path><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"></path></svg>
      Войти в комнату
    </button>
  </div>
</div>
