<script lang="ts">
  import type { AuthUser } from '$lib/api/auth';
  import { friendName } from '../../model/lobby-format';
  import { friendsState, openDm } from '../../model/friends.svelte';
  import Avatar from './Avatar.svelte';
  import SidebarDownload from '../SidebarDownload.svelte';
  import VoiceCallWidget from './VoiceCallWidget.svelte';

  let {
    user,
    onOpenPeople,
    onOpenSettings,
    activeVoiceRoomId = null,
    activeVoiceRoomName = '',
    activeVoiceMuted = false,
    activeVoiceDeafened = false,
    onOpenVoiceRoom,
    onLeaveVoiceRoom,
    onToggleVoiceMic,
    onToggleVoiceDeafen
  } = $props<{
    user: AuthUser;
    onOpenPeople: () => void;
    onOpenSettings: () => void;
    activeVoiceRoomId?: string | null;
    activeVoiceRoomName?: string;
    activeVoiceMuted?: boolean;
    activeVoiceDeafened?: boolean;
    onOpenVoiceRoom?: () => void;
    onLeaveVoiceRoom?: () => void;
    onToggleVoiceMic?: () => void;
    onToggleVoiceDeafen?: () => void;
  }>();

  const sortedFriends = $derived(
    [...friendsState.friends].sort(
      (a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0)
    )
  );

  const selfName = $derived(user.displayName?.trim() || user.login);
  const activeVoiceLabel = $derived(activeVoiceRoomName?.trim() || activeVoiceRoomId || '');

  function friendStatusLabel(entry: (typeof friendsState.friends)[number]): string {
    return entry.online ? 'в сети' : 'не в сети';
  }
</script>

<aside class="lobby-sidebar">
  <div class="lobby-brand">
    <img src="/icon.svg" width="30" height="30" alt="Voice Room" />
    <span class="lobby-brand-name">Voice Room</span>
  </div>

  <div class="lobby-pane">
    <div class="lobby-sec-head">
      <span>Друзья — {friendsState.friends.length}</span>
      <button
        class="lobby-mini-btn"
        type="button"
        title="Заявки и добавить друга"
        onclick={onOpenPeople}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
        {#if friendsState.incomingRequestCount > 0}
          <span class="lobby-mini-btn-dot"></span>
        {/if}
      </button>
    </div>

    <div class="lobby-list lobby-scroll">
      {#if friendsState.friends.length === 0}
        <p class="lobby-empty">Пока нет друзей. Откройте «Заявки», чтобы добавить по логину.</p>
      {:else}
        {#each sortedFriends as entry (entry.user.id)}
          <button
            class="lobby-row"
            class:is-active={friendsState.selectedFriendId === entry.user.id && friendsState.view === 'dm'}
            type="button"
            onclick={() => openDm(entry.user.id)}
          >
            <Avatar name={friendName(entry.user)} colorKey={entry.user.avatarColorKey} online={entry.online} showDot={entry.online} ring="#0a0907" />
            <div class="lobby-row-body">
              <div class="lobby-row-name" style={`font-weight:${entry.unreadCount > 0 ? 750 : 650}`}>{friendName(entry.user)}</div>
              <div class="lobby-row-sub" class:lobby-row-sub--muted={!entry.online}>{friendStatusLabel(entry)}</div>
            </div>
            {#if entry.unreadCount > 0}
              <span class="lobby-badge lobby-badge--sm">{entry.unreadCount}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>

  {#if activeVoiceRoomId}
    <VoiceCallWidget
      roomName={activeVoiceLabel}
      muted={activeVoiceMuted}
      deafened={activeVoiceDeafened}
      onOpen={onOpenVoiceRoom}
      onToggleMic={onToggleVoiceMic}
      onToggleDeafen={onToggleVoiceDeafen}
      onLeave={onLeaveVoiceRoom}
    />
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
