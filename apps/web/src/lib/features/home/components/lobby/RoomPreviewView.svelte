<script lang="ts">
  import { LogIn, MessageSquare, MicOff } from '@lucide/svelte';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import type { RoomPeer } from '$lib/api/rooms';
  import type { RealtimeEvent } from '$lib/api/realtime';
  import { getAvatarPresentation } from '$lib/features/room/client/ui/avatar-presentation';
  import '$lib/features/room/styles/room.css';
  import RoomPreviewChat from './RoomPreviewChat.svelte';
  import RoomViewHeader from './RoomViewHeader.svelte';
  import LobbyStreamTile from './LobbyStreamTile.svelte';
  import { subscribeRoomPreview } from '../../model/room-realtime';

  let { room, user, onEnter, onBack, onOpenSettings, onToast } = $props<{
    room: OwnedRoom;
    user: AuthUser;
    onEnter: () => void;
    onBack: () => void;
    onOpenSettings?: () => void;
    onToast?: (message: string) => void;
  }>();

  let peers = $state<RoomPeer[]>([]);
  let loading = $state(true);

  let previewChatOpen = $state(false);
  const screenPeers = $derived(peers.filter((peer) => peer.screen));
  const tileCount = $derived(peers.length + screenPeers.length);

  function applySnapshot(peerList: RoomPeer[]): void {
    peers = peerList;
    loading = false;
  }

  function handlePreviewEvent(event: RealtimeEvent): void {
    if (event.type === 'room.snapshot' && event.payload.roomId === room.roomId) {
      applySnapshot(event.payload.peers);
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
    const roomId = room.roomId;
    loading = true;
    peers = [];
    previewChatOpen = false;
    const unsubscribe = subscribeRoomPreview(roomId, handlePreviewEvent);
    return unsubscribe;
  });

  function peerName(peer: RoomPeer): string {
    return peer.name?.trim() || 'Гость';
  }

  function peerAvatar(peer: RoomPeer): ReturnType<typeof getAvatarPresentation> {
    return getAvatarPresentation({
      accountUserId: peer.accountUserId,
      avatarAccent: peer.avatarAccent || undefined,
      avatarColorKey: peer.avatarColorKey,
      avatarUrl: peer.avatarUrl || undefined,
      id: peer.id,
      isLocal: false,
      name: peerName(peer)
    });
  }
</script>

<div class="lobby-roomview">
  <div class="lobby-roomview-top">
    <RoomViewHeader {room} {onBack} {onOpenSettings} {onToast} />
    <div class="lobby-roomview-actions">
      {#if !previewChatOpen}
        <button class="room-chat-toggle" type="button" onclick={() => (previewChatOpen = true)}>
          <MessageSquare {...iconSm} aria-hidden="true" />
          <span>Чат</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="lobby-roomview-content" data-preview-chat-open={previewChatOpen}>
    <div class="lobby-roomview-stage-pane">
      <section class="stage lobby-preview-stage" aria-label="Участники комнаты">
        <div class="stage-strip" aria-label="Плитки комнаты">
          <div class="tile-grid" data-count={Math.min(tileCount, 9)} data-streams={Math.min(screenPeers.length, 9)}>
            {#each screenPeers as peer (`screen-${peer.id}`)}
              <LobbyStreamTile {peer} {onEnter} />
            {/each}
            {#each peers as peer (peer.id)}
              {@const avatar = peerAvatar(peer)}
              <div
                class="participant lobby-preview-participant"
                data-peer-id={peer.id}
                data-muted={String(peer.muted)}
                data-screen={String(peer.screen)}
                data-speaking="false"
                style:--level="0"
                style:--participant-pastel={avatar.background}
                style:--participant-avatar-fg={avatar.foreground}
                style:--participant-avatar-shadow={avatar.shadow}
              >
                <div class="voice-ring" aria-hidden="true">
                  <span class="avatar">{avatar.initials}{#if avatar.src}<img src={avatar.src} alt="" onerror={(event) => event.currentTarget.remove()} />{/if}</span>
                </div>
                <div class="participant-copy">
                  <h2>
                    <span class="participant-name">{peerName(peer)}</span>
                    <span class="participant-muted-icon" aria-label="Микрофон выключен" title="Микрофон выключен">
                      <MicOff {...iconSm} aria-hidden="true" />
                    </span>
                  </h2>
                  <p hidden></p>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </section>

      {#if peers.length === 0 && !loading}
        <div class="lobby-stage-empty">
          <p class="lobby-stage-empty-note">Пока никого нет</p>
        </div>
      {/if}

      <button class="lobby-roomview-join" type="button" onclick={onEnter}>
        <LogIn {...iconMd} aria-hidden="true" />
        Войти в комнату
      </button>
    </div>

    {#if previewChatOpen}
      {#key room.roomId}
        <RoomPreviewChat roomId={room.roomId} {user} {onToast} onClose={() => (previewChatOpen = false)} />
      {/key}
    {/if}
  </div>
</div>
