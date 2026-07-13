<script lang="ts">
  import { Moon, Settings, UserPlus } from '@lucide/svelte';
  import type { AuthUser } from '$lib/api/auth';
  import { Avatar, Badge, ContextMenu, Popover, PopoverMenuItem } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import { friendName } from '../../model/lobby-format';
  import { friendsState, openDm } from '../../model/friends.svelte';
  import { notificationPreferences, updateDoNotDisturb } from '$lib/shared/notifications/preferences.svelte';
  import SidebarDownload from '../SidebarDownload.svelte';
  import { FriendMenuContent } from '../friend-menu';
  import VoiceCallWidget from './VoiceCallWidget.svelte';

  let {
    user,
    onGoHome,
    onOpenPeople,
    onOpenSettings,
    onToast,
    activeVoiceRoomId = null,
    activeVoiceRoomName = '',
    activeVoiceRoomAvatarUrl = null,
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
    onToast: (message: string) => void;
    activeVoiceRoomId?: string | null;
    activeVoiceRoomName?: string;
    activeVoiceRoomAvatarUrl?: string | null;
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
  let dndSaving = $state(false);
  let contextFriendId = $state('');
  let contextX = $state(0);
  let contextY = $state(0);
  let contextTrigger = $state<HTMLElement | null>(null);
  const contextFriend = $derived(friendsState.friends.find((entry) => entry.user.id === contextFriendId));

  function openFriendContextMenu(event: MouseEvent, userId: string): void {
    event.preventDefault();
    event.stopPropagation();
    contextFriendId = userId;
    contextX = event.clientX;
    contextY = event.clientY;
    contextTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  }

  function handleFriendKeydown(event: KeyboardEvent, userId: string): void {
    const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!isContextKey || !(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    contextFriendId = userId;
    contextX = rect.left + Math.min(rect.width - 12, 48);
    contextY = rect.top + Math.min(rect.height - 8, 36);
    contextTrigger = event.currentTarget;
  }

  function closeFriendContextMenu(): void {
    contextFriendId = '';
  }

  async function toggleDnd(close: () => void): Promise<void> {
    if (dndSaving) return;
    dndSaving = true;
    try {
      await updateDoNotDisturb(!notificationPreferences.doNotDisturb);
      onToast(notificationPreferences.doNotDisturb ? 'Режим «Не беспокоить» включён' : 'Режим «Не беспокоить» выключен');
      close();
    } catch {
      onToast('Не удалось изменить режим «Не беспокоить»');
    } finally {
      dndSaving = false;
    }
  }
</script>

<aside class="lv-side">
  <button class="lv-side-head" type="button" title="Главная" onclick={onGoHome} style="border:none;background:transparent;cursor:pointer;text-align:left;">
    <img src="/voiceroom-mascot.svg" width="26" height="26" alt="Voice Room" />
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
          class:is-context={contextFriendId === entry.user.id}
          type="button"
          onclick={() => openDm(entry.user.id)}
          oncontextmenu={(event) => openFriendContextMenu(event, entry.user.id)}
          onkeydown={(event) => handleFriendKeydown(event, entry.user.id)}
          aria-haspopup="menu"
        >
          <Avatar name={friendName(entry.user)} src={entry.user.avatarUrl} colorKey={entry.user.avatarColorKey} background={entry.user.avatarAccent || undefined} online={entry.online} dnd={entry.user.doNotDisturb} showDot ring="var(--panel)" />
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
      avatarUrl={activeVoiceRoomAvatarUrl}
      muted={activeVoiceMuted}
      deafened={activeVoiceDeafened}
      onOpen={onOpenVoiceRoom}
      onToggleMic={onToggleVoiceMic}
      onToggleDeafen={onToggleVoiceDeafen}
      onLeave={onLeaveVoiceRoom}
    />
  {/if}

  <div class="lv-profile">
    <Popover placement="top-start" role="menu" ariaLabel="Меню пользователя">
      {#snippet trigger({ open, toggle, panelId })}
        <button type="button" class="lv-profile-user" aria-expanded={open} aria-controls={panelId} onclick={toggle}>
          <Avatar name={selfName} src={user.avatarUrl} colorKey={user.avatarColorKey} background={user.avatarAccent || undefined} size={34} online dnd={notificationPreferences.doNotDisturb} showDot ring="var(--panel)" />
          <span style="min-width:0;flex:1;text-align:left;">
            <span class="lv-row-name" style="display:block;">{selfName}</span>
            <span class="lv-profile-handle" style="display:block;">@{user.login}</span>
          </span>
        </button>
      {/snippet}
      {#snippet content({ close })}
        <PopoverMenuItem label={notificationPreferences.doNotDisturb ? 'Выключить «Не беспокоить»' : 'Включить «Не беспокоить»'} disabled={dndSaving} onclick={() => void toggleDnd(close)}>
          {#snippet icon()}<Moon {...iconSm} aria-hidden="true" />{/snippet}
        </PopoverMenuItem>
      {/snippet}
    </Popover>
    <div class="lv-profile-actions">
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
  </div>
</aside>

{#if contextFriend}
  <ContextMenu
    open={Boolean(contextFriendId)}
    x={contextX}
    y={contextY}
    ariaLabel={`Действия для ${friendName(contextFriend.user)}`}
    restoreFocus={contextTrigger}
    onClose={closeFriendContextMenu}
  >
    {#snippet content({ close })}
      {#key contextFriend.user.id}
        <FriendMenuContent
          friend={contextFriend}
          {close}
          canClose={(userId) => contextFriendId === userId}
          {onToast}
        />
      {/key}
    {/snippet}
  </ContextMenu>
{/if}

<style>
  .lv-profile-user {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 9px;
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .lv-profile-actions {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    margin-left: auto;
  }
</style>
