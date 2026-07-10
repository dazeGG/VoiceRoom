<script lang="ts">
  import { Settings, UserPlus } from '@lucide/svelte';
  import type { AuthUser } from '$lib/api/auth';
  import type { RoomPresetToken } from '$lib/visual/tokens';
  import { Avatar, Badge } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import { friendName } from '../../model/lobby-format';
  import { friendsState, openDm } from '../../model/friends.svelte';
  import SidebarDownload from '../SidebarDownload.svelte';
  import VoiceCallWidget from './VoiceCallWidget.svelte';

  let {
    user,
    onGoHome,
    onOpenPeople,
    onOpenSettings,
    activeVoiceRoomId = null,
    activeVoiceRoomName = '',
    activeVoiceRoomVisual = null,
    activeVoiceMuted = false,
    activeVoiceDeafened = false,
    onOpenVoiceRoom,
    onLeaveVoiceRoom,
    onToggleVoiceMic,
    onToggleVoiceDeafen
  } = $props<{
    user: AuthUser;
    onGoHome: () => void;
    onOpenPeople: () => void;
    onOpenSettings: () => void;
    activeVoiceRoomId?: string | null;
    activeVoiceRoomName?: string;
    activeVoiceRoomVisual?: RoomPresetToken | null;
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
</script>

<aside class="lv-side">
  <button class="lv-side-head" type="button" title="Главная" onclick={onGoHome} style="border:none;background:transparent;cursor:pointer;text-align:left;">
    <img src="/icon.svg" width="26" height="26" alt="Voice Room" />
    <span class="lv-brand-name">Voice Room</span>
  </button>

  <div class="lv-side-scroll">
    <div class="lv-sec-head">
      <span>Друзья — {friendsState.friends.length}</span>
      <div class="lv-sec-actions">
        <button class="lv-mini-btn" type="button" title="Заявки и добавить друга" onclick={onOpenPeople}>
          <UserPlus {...iconSm} aria-hidden="true" />
          {#if friendsState.incomingRequestCount > 0}
            <span class="lv-mini-btn-dot"></span>
          {/if}
        </button>
      </div>
    </div>

    {#if friendsState.friends.length === 0}
      <p class="lr-empty" style="padding:2px 7px 8px;">Пока нет друзей. Откройте «Заявки», чтобы добавить по логину.</p>
    {:else}
      {#each sortedFriends as entry (entry.user.id)}
        <button
          class="lv-row"
          class:is-active={friendsState.selectedFriendId === entry.user.id && friendsState.view === 'dm'}
          type="button"
          onclick={() => openDm(entry.user.id)}
        >
          <Avatar name={friendName(entry.user)} colorKey={entry.user.avatarColorKey} online={entry.online} showDot={entry.online} ring="var(--panel)" />
          <div style="min-width:0;flex:1;">
            <div class="lv-row-name" style={`font-weight:${entry.unreadCount > 0 ? 750 : 650}`}>{friendName(entry.user)}</div>
          </div>
          {#if entry.unreadCount > 0}
            <Badge>{entry.unreadCount}</Badge>
          {/if}
        </button>
      {/each}
    {/if}
  </div>

  {#if activeVoiceRoomId}
    <VoiceCallWidget
      roomName={activeVoiceLabel}
      roomVisual={activeVoiceRoomVisual}
      muted={activeVoiceMuted}
      deafened={activeVoiceDeafened}
      onOpen={onOpenVoiceRoom}
      onToggleMic={onToggleVoiceMic}
      onToggleDeafen={onToggleVoiceDeafen}
      onLeave={onLeaveVoiceRoom}
    />
  {/if}

  <div class="lv-profile">
    <Avatar name={selfName} colorKey={user.avatarColorKey} size={34} online showDot ring="var(--panel)" />
    <div style="min-width:0;flex:1;">
      <div class="lv-row-name">{selfName}</div>
      <div class="lv-profile-handle">@{user.login}</div>
    </div>
    <SidebarDownload />
    <button
      class="lobby-gear"
      type="button"
      title="Настройки"
      aria-label="Открыть настройки"
      onclick={onOpenSettings}
    >
      <Settings {...iconSm} aria-hidden="true" />
    </button>
  </div>
</aside>
