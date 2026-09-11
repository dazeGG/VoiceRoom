<script lang="ts">
  import { untrack } from 'svelte';
  import { ChevronRight, LogIn, MessageSquare, MicOff, Users } from '@lucide/svelte';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import type { RoomPeer } from '$lib/api/rooms';
  import type { RealtimeEvent } from '$lib/api/realtime';
  import { getAvatarPresentation } from '$lib/features/room/client/ui/avatar-presentation';
  import '$lib/features/room/styles/room.css';
  import RoomPreviewChat from './RoomPreviewChat.svelte';
  import RoomMemberList from './RoomMemberList.svelte';
  import RoomViewHeader from './RoomViewHeader.svelte';
  import LobbyStreamTile from './LobbyStreamTile.svelte';
  import { subscribeRoomPreview } from '../../model/room-realtime';
  import { roomPresence } from '../../model/room-presence.svelte';
  import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';

  let {
    room,
    user,
    initialPanel = null,
    aroundMessageId = undefined,
    onEnter,
    onBack,
    onOpenSettings,
    onRoomsChanged,
    onToast
  } = $props<{
    room: OwnedRoom;
    user: AuthUser;
    /**
     * Panel to show when this room is first previewed. A mention link opens the
     * chat straight away, without joining voice.
     */
    initialPanel?: 'chat' | 'participants' | null;
    /** Scroll the chat to this message once it opens. */
    aroundMessageId?: string;
    onEnter: () => void;
    onBack: () => void;
    onOpenSettings?: () => void;
    onRoomsChanged?: () => void;
    onToast?: (message: string) => void;
  }>();

  let peers = $state<RoomPeer[]>([]);
  let loading = $state(true);
  let membershipEnabled = $state(false);
  let activePanel = $state<'chat' | 'participants' | null>(null);

  const previewRoomId = $derived(room.roomId);
  const roomUnreadCount = $derived(roomPresence.unreadCountByRoomId[previewRoomId] ?? room.unreadCount ?? 0);
  const screenPeers = $derived(peers.filter((peer) => peer.screen));
  const presentUserIds = $derived(new Set(peers.map((peer) => peer.accountUserId || '').filter(Boolean)));
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
    const roomId = previewRoomId;
    loading = true;
    peers = [];
    // Read untracked: the effect belongs to the room, and re-running it for a
    // new anchor would tear down and resubscribe the preview for nothing. A new
    // anchor remounts this view instead.
    activePanel = untrack(() => initialPanel);
    const unsubscribe = subscribeRoomPreview(roomId, handlePreviewEvent);
    return unsubscribe;
  });

  $effect(() => {
    let active = true;
    void getCapabilityFeature('membership').then((enabled) => {
      if (active) membershipEnabled = enabled;
    });
    return () => {
      active = false;
    };
  });

  function peerName(peer: RoomPeer): string {
    return peer.name?.trim() || 'Гость';
  }

  function peerAvatar(peer: RoomPeer): ReturnType<typeof getAvatarPresentation> {
    return getAvatarPresentation({
      avatarAccent: peer.avatarAccent || undefined,
      avatarColorKey: peer.avatarColorKey,
      avatarUrl: peer.avatarUrl || undefined,
      isLocal: false,
      name: peerName(peer)
    });
  }

  function selectPanel(panel: 'chat' | 'participants'): void {
    if (panel === 'participants' && !membershipEnabled) return;
    activePanel = panel;
  }
</script>

<div class="lobby-roomview">
  <div class="lobby-roomview-top">
    <RoomViewHeader {room} {presentUserIds} {onBack} {onOpenSettings} {onRoomsChanged} {onToast} />
    <div class="lobby-roomview-actions">
      <div class="room-panel-tabs room-panel-tabs--topbar" role="group" aria-label="Открыть раздел панели комнаты">
        <button
          type="button"
          aria-label="Чат"
          aria-pressed={activePanel === 'chat'}
          data-active={activePanel === 'chat'}
          title="Чат"
          onclick={() => selectPanel('chat')}
        >
          <MessageSquare {...iconSm} aria-hidden="true" />
          {#if roomUnreadCount > 0}<span class="room-panel-tab-unread" aria-hidden="true"></span>{/if}
        </button>
        <button
          type="button"
          aria-label="Участники"
          aria-pressed={activePanel === 'participants'}
          data-active={activePanel === 'participants'}
          title="Участники"
          disabled={!membershipEnabled}
          onclick={() => selectPanel('participants')}
        >
          <Users {...iconSm} aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>

  <div
    class="lobby-roomview-content"
    data-preview-chat-open={activePanel === 'chat'}
    data-members-open={activePanel === 'participants'}
  >
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

    {#if activePanel === 'chat'}
      {#key previewRoomId}
        <RoomPreviewChat
          roomId={previewRoomId}
          {user}
          {aroundMessageId}
          canModerate={room.relationship === 'owner'}
          {onToast}
          onClose={() => (activePanel = null)}
          onSelectParticipants={() => selectPanel('participants')}
        />
      {/key}
    {:else if activePanel === 'participants' && membershipEnabled}
      <aside class="lobby-room-members" aria-label="Список участников комнаты">
        <header class="chat-rail-head">
          <div class="room-panel-tabs" role="tablist" aria-label="Раздел панели комнаты">
            <button type="button" role="tab" aria-label="Чат" aria-selected="false" data-active="false" title="Чат" onclick={() => selectPanel('chat')}>
              <MessageSquare {...iconSm} aria-hidden="true" />
            </button>
            <button type="button" role="tab" aria-label="Участники" aria-selected="true" data-active="true" title="Участники">
              <Users {...iconSm} aria-hidden="true" />
            </button>
          </div>
          <button class="chat-rail-collapse" type="button" aria-label="Свернуть панель" onclick={() => (activePanel = null)}>
            <ChevronRight {...iconSm} aria-hidden="true" />
          </button>
        </header>
        <div class="lobby-room-members-body"><RoomMemberList roomId={previewRoomId} /></div>
      </aside>
    {/if}
  </div>
</div>
