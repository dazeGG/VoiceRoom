<script lang="ts">
  import { AvatarStack } from '$lib/shared/ui';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import type { RoomPeer } from '$lib/api/rooms';
  import { roomPresence } from '../../model/room-presence.svelte';
  import { roomPeerAvatarItems } from '../../model/room-avatars';
  import { roomDisplayName, roomVisual } from '../../model/rooms';
  import { friendName } from '../../model/lobby-format';
  import {
    friendsState,
    openDm,
    setMode,
    showAdd,
    showRequests
  } from '../../model/friends.svelte';
  import Avatar from './Avatar.svelte';
  import SidebarDownload from '../SidebarDownload.svelte';

  let {
    user,
    rooms,
    roomCode = $bindable(''),
    selectedRoomId = null,
    onOpenRoom,
    onCreateRoom,
    onJoinRoom,
    onAddRoom,
    onOpenSettings,
    activeVoiceRoomId = null,
    activeVoiceRoomName = '',
    onOpenVoiceRoom,
    onLeaveVoiceRoom
  } = $props<{
    user: AuthUser;
    rooms: OwnedRoom[];
    roomCode?: string;
    selectedRoomId?: string | null;
    onOpenRoom: (roomId: string) => void;
    onCreateRoom: () => void;
    onJoinRoom: () => void;
    onAddRoom: () => void;
    onOpenSettings: () => void;
    activeVoiceRoomId?: string | null;
    activeVoiceRoomName?: string;
    onOpenVoiceRoom?: () => void;
    onLeaveVoiceRoom?: () => void;
  }>();

  let search = $state('');

  const filtered = $derived(
    search.trim()
      ? friendsState.friends.filter((entry) =>
          friendName(entry.user).toLowerCase().includes(search.trim().toLowerCase()) ||
          entry.user.login.toLowerCase().includes(search.trim().toLowerCase())
        )
      : friendsState.friends
  );
  const online = $derived(filtered.filter((entry) => entry.online));
  const offline = $derived(filtered.filter((entry) => !entry.online));

  const selfName = $derived(user.displayName?.trim() || user.login);
  const activeVoiceLabel = $derived(activeVoiceRoomName?.trim() || activeVoiceRoomId || '');

  function friendStatusLabel(entry: (typeof friendsState.friends)[number]): string {
    return entry.online ? 'в сети' : 'не в сети';
  }

  function onJoinKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      onJoinRoom();
    }
  }


  function selfPeer(): RoomPeer {
    return {
      avatarColorKey: user.avatarColorKey,
      id: `auth-${user.id}`,
      muted: false,
      name: selfName
    };
  }

  function roomPeersForDisplay(roomId: string): RoomPeer[] {
    const peers = roomPresence.peersByRoomId[roomId] || [];
    if (activeVoiceRoomId !== roomId) return peers;

    const localPeer = selfPeer();
    if (peers.some((peer) => peer.id === localPeer.id)) return peers;
    return [...peers, localPeer];
  }

  function roomPeerCount(room: OwnedRoom): number {
    return Math.max(room.peers, roomPeersForDisplay(room.roomId).length);
  }

  function roomAvatars(roomId: string) {
    return roomPeerAvatarItems(roomPeersForDisplay(roomId));
  }
</script>

<aside class="lobby-sidebar">
  <div class="lobby-brand">
    <img src="/icon.svg" width="30" height="30" alt="Voice Room" />
    <span class="lobby-brand-name">Voice Room</span>
  </div>

  <div class="lobby-switch">
    <button
      class="lobby-switch-btn"
      class:is-active={friendsState.mode === 'friends'}
      type="button"
      onclick={() => setMode('friends')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"></circle><path d="M3 20a6 6 0 0 1 12 0"></path><path d="M16 5.5a3 3 0 0 1 0 5"></path><path d="M17.5 20a5.5 5.5 0 0 0-3-4.6"></path></svg>
      Друзья
    </button>
    <button
      class="lobby-switch-btn"
      class:is-active={friendsState.mode === 'rooms'}
      type="button"
      onclick={() => setMode('rooms')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M6 11a6 6 0 0 0 12 0"></path><line x1="12" y1="17" x2="12" y2="21"></line></svg>
      Комнаты
    </button>
  </div>

  {#if friendsState.mode === 'friends'}
    <div class="lobby-pane">
      <div class="lobby-side-head">
        <label class="lobby-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
          <input type="text" placeholder="Поиск друзей" bind:value={search} />
        </label>
        <button class="lobby-add-btn" type="button" onclick={showAdd}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Добавить друга
        </button>
      </div>

      <button class="lobby-requests-row" type="button" onclick={showRequests}>
        <span class="lobby-requests-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
        </span>
        <span class="lobby-requests-label">Заявки в друзья</span>
        {#if friendsState.incomingRequestCount > 0}
          <span class="lobby-badge">{friendsState.incomingRequestCount}</span>
        {/if}
      </button>

      <div class="lobby-list lobby-scroll">
        {#if friendsState.friends.length === 0}
          <p class="lobby-empty">Пока нет друзей. Нажмите «Добавить друга», чтобы найти знакомых по логину.</p>
        {:else}
          {#if online.length > 0}
            <div class="lobby-mono lobby-list-head">В сети — {online.length}</div>
            {#each online as entry (entry.user.id)}
              <button
                class="lobby-row"
                class:is-active={friendsState.selectedFriendId === entry.user.id && friendsState.view === 'dm'}
                type="button"
                onclick={() => openDm(entry.user.id)}
              >
                <Avatar name={friendName(entry.user)} colorKey={entry.user.avatarColorKey} online showDot ring="#0a0907" />
                <div class="lobby-row-body">
                  <div class="lobby-row-name">{friendName(entry.user)}</div>
                  <div class="lobby-row-sub">{friendStatusLabel(entry)}</div>
                </div>
                {#if entry.unreadCount > 0}
                  <span class="lobby-badge lobby-badge--sm">{entry.unreadCount}</span>
                {/if}
              </button>
            {/each}
          {/if}

          {#if offline.length > 0}
            <div class="lobby-mono lobby-list-head" style="padding-top:16px;">Не в сети — {offline.length}</div>
            {#each offline as entry (entry.user.id)}
              <button
                class="lobby-row lobby-row--offline"
                class:is-active={friendsState.selectedFriendId === entry.user.id && friendsState.view === 'dm'}
                type="button"
                onclick={() => openDm(entry.user.id)}
              >
                <Avatar name={friendName(entry.user)} colorKey={entry.user.avatarColorKey} />
                <div class="lobby-row-body">
                  <div class="lobby-row-name">{friendName(entry.user)}</div>
                  <div class="lobby-row-sub lobby-row-sub--muted">{friendStatusLabel(entry)}</div>
                </div>
                {#if entry.unreadCount > 0}
                  <span class="lobby-badge lobby-badge--sm">{entry.unreadCount}</span>
                {/if}
              </button>
            {/each}
          {/if}
        {/if}
      </div>
    </div>
  {:else}
    <div class="lobby-pane">
      <div class="lobby-side-head">
        <button class="lobby-primary" type="button" onclick={onCreateRoom}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Создать комнату
        </button>
        <div class="lobby-search lobby-join-code">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
          <input
            type="text"
            placeholder="Войти по коду"
            style="font-family:var(--font-mono);font-size:12.5px;"
            bind:value={roomCode}
            onkeydown={onJoinKeydown}
          />
          <button
            type="button"
            class="lobby-join-code-button"
            onclick={onJoinRoom}
          >Войти</button>
        </div>
      </div>

      <div class="lobby-list lobby-scroll" style="padding-top:8px;">
        <div class="lobby-list-head lobby-list-head--row">
          <span class="lobby-mono">Мои комнаты</span>
          <button class="lobby-icon-btn" type="button" title="Добавить комнату по коду" onclick={onAddRoom}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
        </div>
        {#if rooms.length === 0}
          <p class="lobby-empty">Создайте комнату или добавьте существующую по коду.</p>
        {:else}
          {#each rooms as room (room.roomId)}
            {@const visual = roomVisual(room)}
            {@const displayPeers = roomPeerCount(room)}
            <button
              class="lobby-row lobby-row--room"
              class:is-active={selectedRoomId === room.roomId}
              type="button"
              onclick={() => onOpenRoom(room.roomId)}
            >
              <span class="lobby-tile" style={`width:38px;height:38px;font-size:18px;background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`}>{visual.emoji}</span>
              <div class="lobby-row-body">
                <div class="lobby-row-name">{roomDisplayName(room)}</div>
                {#if displayPeers > 0}
                  <div class="lobby-voices">
                    <span class="lobby-live-dot"></span>
                    <AvatarStack items={roomAvatars(room.roomId)} maxAvatars={5} size={22} ariaLabel="В комнате" />
                    <span class="lobby-row-sub" style="color:#8fa888;">{displayPeers} в эфире</span>
                  </div>
                {:else}
                  <div class="lobby-row-sub lobby-row-sub--muted">тихо сейчас</div>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  {#if activeVoiceRoomId}
    <div class="lobby-voice-panel" aria-label="Активный голос">
      <div class="lobby-voice-state">
        <span class="lobby-live-dot" aria-hidden="true"></span>
        <span>Вы в голосе</span>
      </div>
      <div class="lobby-voice-room" title={activeVoiceLabel}>{activeVoiceLabel}</div>
      <div class="lobby-voice-actions">
        <button class="lobby-voice-open" type="button" onclick={onOpenVoiceRoom}>Открыть</button>
        <button class="lobby-voice-leave" type="button" onclick={onLeaveVoiceRoom} aria-label="Выйти из голосовой комнаты">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
        </button>
      </div>
    </div>
  {/if}

  <div class="lobby-profile">
    <Avatar name={selfName} colorKey={user.avatarColorKey} size={34} />
    <div class="lobby-row-body">
      <div class="lobby-profile-name">{selfName}</div>
      <div class="lobby-profile-handle">@{user.login}</div>
    </div>
    <SidebarDownload />
    <button
      class="lobby-gear"
      type="button"
      title="Настройки"
      aria-label="Открыть настройки"
      onclick={onOpenSettings}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"></path></svg>
    </button>
  </div>
</aside>
