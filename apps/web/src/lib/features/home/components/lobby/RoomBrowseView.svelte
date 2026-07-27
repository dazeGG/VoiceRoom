<script lang="ts">
  import { ChevronRight, LogIn, MessageSquare, MicOff, Users } from '@lucide/svelte';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import type { RoomPeer } from '$lib/api/rooms';
  import type { RealtimeEvent } from '$lib/api/realtime';
  import { roomDisplayName } from '../../model/rooms';
  import { getAvatarPresentation } from '$lib/features/room/client/ui/avatar-presentation';
  import '$lib/features/room/styles/room.css';
  import RoomPreviewChat from './RoomPreviewChat.svelte';
  import RoomMemberList from './RoomMemberList.svelte';
  import RoomViewHeader from './RoomViewHeader.svelte';
  import LobbyStreamTile from './LobbyStreamTile.svelte';
  import { subscribeRoomPreview } from '../../model/room-realtime';
  import { roomPresence } from '../../model/room-presence.svelte';
  import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';

  let { room, user, onEnter, onBack, onOpenSettings, onToast } = $props<{
    room: OwnedRoom;
    user: AuthUser;
    onEnter: () => void;
    onBack: () => void;
    onOpenSettings?: () => void;
    onToast?: (message: string) => void;
  }>();

  const name = $derived(roomDisplayName(room));
  const previewRoomId = $derived(room.roomId);
  const roomUnreadCount = $derived(roomPresence.unreadCountByRoomId[previewRoomId] ?? room.unreadCount ?? 0);
  let peers = $state<RoomPeer[]>([]);
  let loading = $state(true);
  let membershipEnabled = $state(false);
  let activePanel = $state<'chat' | 'participants' | null>(null);

  let loadError = $state('');
  const screenPeers = $derived(peers.filter((peer) => peer.screen));
  const tileCount = $derived(peers.length + screenPeers.length);

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
    const roomId = previewRoomId;
    loading = true;
    peers = [];
    loadError = '';
    activePanel = null;
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

<div class="lobby-browse-room" aria-label={`Комната ${name}`}>
  <header class="lobby-browse-topbar">
    <RoomViewHeader {room} {onBack} {onOpenSettings} {onToast} />
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
  </header>

  <div
    class="lobby-roomview-content lobby-browse-content"
    data-preview-chat-open={activePanel === 'chat'}
    data-members-open={activePanel === 'participants'}
  >
    <main class="lobby-browse-stage lobby-roomview-stage-pane" aria-label="Просмотр комнаты без подключения к голосу">
      <section class="stage lobby-preview-stage" aria-label="Участники комнаты">
        <div class="stage-strip" aria-label="Плитки комнаты">
          <div
            class="tile-grid"
            data-count={Math.min(tileCount, 9)}
            data-streams={Math.min(screenPeers.length, 9)}
          >
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

      {#if loadError}
        <p class="lobby-stage-error" role="status">{loadError}</p>
      {:else if peers.length === 0 && !loading}
        <div class="lobby-stage-empty">
          <p class="lobby-stage-empty-note">Пока никого нет</p>
        </div>
      {/if}

      <button class="lobby-roomview-join" type="button" onclick={onEnter}>
        <LogIn {...iconMd} aria-hidden="true" />
        Войти в комнату
      </button>
    </main>

    {#if activePanel === 'chat'}
      {#key previewRoomId}
        <RoomPreviewChat
          roomId={previewRoomId}
          {user}
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
