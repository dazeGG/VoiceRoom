<script lang="ts">
  import { onMount } from 'svelte';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { fetchRoomPeers, type RoomPeer } from '$lib/api/rooms';
  import { getAvatarColor } from '$lib/visual/tokens';
  import { initial } from '../../model/lobby-format';
  import RoomPreviewChat from './RoomPreviewChat.svelte';
  import RoomViewHeader from './RoomViewHeader.svelte';

  let { room, user, onEnter, onBack, onToast } = $props<{
    room: OwnedRoom;
    user: AuthUser;
    onEnter: () => void;
    onBack: () => void;
    onToast?: (message: string) => void;
  }>();

  let peers = $state<RoomPeer[]>([]);
  let loading = $state(true);

  let previewChatOpen = $state(true);

  async function refresh(): Promise<void> {
    try {
      peers = await fetchRoomPeers(room.roomId);
    } catch {
      // Keep the last snapshot on a transient failure.
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void room.roomId;
    loading = true;
    peers = [];
    previewChatOpen = true;
    void refresh();
  });

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
    <RoomViewHeader {room} {onBack} {onToast} />
    <div class="lobby-roomview-actions">
      {#if peers.length > 0}
        <span class="lobby-roomview-state" data-live="true">
          <span class="lobby-live-dot"></span>
          {peers.length} в эфире
        </span>
      {/if}
      {#if !previewChatOpen}
        <button class="room-chat-toggle" type="button" onclick={() => (previewChatOpen = true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span>Чат</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="lobby-roomview-content" data-preview-chat-open={previewChatOpen}>
    <div class="lobby-roomview-stage-pane">
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
      {:else if !loading}
        <div class="lobby-stage-empty">
          <p class="lobby-stage-empty-note">Пока никого нет</p>
        </div>
      {/if}

      <button class="lobby-roomview-join" type="button" onclick={onEnter}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17l5-5-5-5"></path><path d="M20 12H9"></path><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"></path></svg>
        Войти в комнату
      </button>
    </div>

    {#if previewChatOpen}
      {#key room.roomId}
        <RoomPreviewChat roomId={room.roomId} {user} onClose={() => (previewChatOpen = false)} />
      {/key}
    {/if}
  </div>
</div>
