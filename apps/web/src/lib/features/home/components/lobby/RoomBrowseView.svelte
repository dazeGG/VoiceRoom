<script lang="ts">
  import { AvatarStack } from '$lib/shared/ui';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import type { RoomPeer } from '$lib/api/rooms';
  import type { RealtimeEvent } from '$lib/api/realtime';
  import { roomDisplayName } from '../../model/rooms';
  import { getAvatarPresentation } from '$lib/features/room/client/ui/avatar-presentation';
  import '$lib/features/room/styles/room.css';
  import RoomPreviewChat from './RoomPreviewChat.svelte';
  import RoomViewHeader from './RoomViewHeader.svelte';
  import { roomPeerAvatarItems } from '../../model/room-avatars';
  import { subscribeRoomPreview } from '../../model/room-realtime';

  let { room, user, onEnter, onBack, onToast } = $props<{
    room: OwnedRoom;
    user: AuthUser;
    onEnter: () => void;
    onBack: () => void;
    onToast?: (message: string) => void;
  }>();

  const name = $derived(roomDisplayName(room));

  let peers = $state<RoomPeer[]>([]);
  let loading = $state(true);

  let previewChatOpen = $state(false);
  let loadError = $state('');
  const peerAvatars = $derived(roomPeerAvatarItems(peers));

  function handlePreviewEvent(event: RealtimeEvent): void {
    if (event.type === 'room.snapshot' && event.payload.roomId === room.roomId) {
      peers = event.payload.peers;
      loading = false;
      loadError = '';
      return;
    }
    if (event.type === 'room.not_found' && event.payload.roomId === room.roomId) {
      loadError = 'Комната не найдена';
      loading = false;
      return;
    }
    if (event.type === 'room.peer.joined' && event.payload.roomId === room.roomId) {
      if (!peers.some((peer) => peer.id === event.payload.peer.id)) {
        peers = [...peers, event.payload.peer];
      }
      return;
    }
    if (event.type === 'room.peer.left' && event.payload.roomId === room.roomId) {
      peers = peers.filter((peer) => peer.id !== event.payload.peerId);
      return;
    }
    if (event.type === 'room.peer.updated' && event.payload.roomId === room.roomId) {
      peers = peers.map((peer) => (peer.id === event.payload.peer.id ? event.payload.peer : peer));
    }
  }

  $effect(() => {
    void room.roomId;
    loading = true;
    peers = [];
    loadError = '';
    previewChatOpen = false;
    const unsubscribe = subscribeRoomPreview(room.roomId, handlePreviewEvent);
    return unsubscribe;
  });

  function peerName(peer: RoomPeer): string {
    return peer.name?.trim() || 'Гость';
  }

  function peerAvatar(peer: RoomPeer): ReturnType<typeof getAvatarPresentation> {
    return getAvatarPresentation({
      avatarColorKey: peer.avatarColorKey,
      isLocal: false,
      name: peerName(peer)
    });
  }
</script>

<div class="lobby-browse-room" aria-label={`Комната ${name}`}>
  <header class="lobby-browse-topbar">
    <RoomViewHeader {room} {onBack} {onToast} />
    <div class="lobby-roomview-actions">
      {#if peers.length > 0}
        <span class="lobby-roomview-state" data-live="true">
          <span class="lobby-live-dot"></span>
          <AvatarStack items={peerAvatars} maxAvatars={5} size={24} ariaLabel="В комнате" />
          <span>{peers.length} в эфире</span>
        </span>
      {/if}
      {#if !previewChatOpen}
        <button class="room-chat-toggle" type="button" onclick={() => (previewChatOpen = true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span>Чат</span>
        </button>
      {/if}
    </div>
  </header>

  <div class="lobby-roomview-content lobby-browse-content" data-preview-chat-open={previewChatOpen}>
    <main class="lobby-browse-stage lobby-roomview-stage-pane" aria-label="Просмотр комнаты без подключения к голосу">
      <section class="stage lobby-preview-stage" aria-label="Участники комнаты">
        <div class="stage-strip" aria-label="Плитки комнаты">
          <div
            class="tile-grid"
            data-count={Math.min(peers.length, 8)}
            data-streams="0"
          >
            {#each peers as peer (peer.id)}
              {@const avatar = peerAvatar(peer)}
              <div
                class="participant lobby-preview-participant"
                data-peer-id={peer.id}
                data-muted={String(peer.muted)}
                data-screen="false"
                data-speaking="false"
                style:--level="0"
                style:--participant-pastel={avatar.background}
                style:--participant-avatar-fg={avatar.foreground}
                style:--participant-avatar-shadow={avatar.shadow}
              >
                <div class="voice-ring" aria-hidden="true">
                  <span class="avatar">{avatar.initials}</span>
                </div>
                <div class="participant-copy">
                  <h2>
                    <span class="participant-name">{peerName(peer)}</span>
                    <span class="participant-muted-icon" aria-label="Микрофон выключен" title="Микрофон выключен">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="3" x2="21" y2="21"></line><path d="M9 9v3a3 3 0 0 0 5.1 2.1"></path><path d="M15 11V5a3 3 0 0 0-5.9-.8"></path><path d="M6 11a6 6 0 0 0 9 5.2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                    </span>
                  </h2>
                  <p hidden></p>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </section>

      {#if loadError}
        <p class="lobby-stage-error" role="status">{loadError}</p>
      {:else if peers.length === 0 && !loading}
        <div class="lobby-stage-empty">
          <p class="lobby-stage-empty-note">Пока никого нет</p>
        </div>
      {/if}

      <button class="lobby-roomview-join" type="button" onclick={onEnter}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17l5-5-5-5"></path><path d="M20 12H9"></path><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"></path></svg>
        Войти в комнату
      </button>
    </main>

    {#if previewChatOpen}
      {#key room.roomId}
        <RoomPreviewChat roomId={room.roomId} {user} onClose={() => (previewChatOpen = false)} />
      {/key}
    {/if}
  </div>
</div>