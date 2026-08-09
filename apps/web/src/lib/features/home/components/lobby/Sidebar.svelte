<script lang="ts">
  import { Bell, BellOff, Check, Settings, UserPlus } from '@lucide/svelte';
  import { tick } from 'svelte';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { Avatar, Badge, ContextMenu, Popover, PopoverMenuLabel } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import {
    effectivePresenceStatus,
    normalizePresenceStatus,
    type PresenceStatus
  } from '$lib/shared/presence';
  import { friendName } from '../../model/lobby-format';
  import { friendsState, openDm } from '../../model/friends.svelte';
  import { notificationPreferences, updatePresenceStatus } from '$lib/shared/notifications/preferences.svelte';
  import SidebarDownload from '../SidebarDownload.svelte';
  import { FriendMenuContent } from '../friend-menu';
  import VoiceCallWidget from './VoiceCallWidget.svelte';

  let {
    user,
    rooms = [],
    onGoHome,
    onOpenPeople,
    onOpenSettings,
    notificationsEnabled = false,
    notificationsOpen = false,
    notificationUnreadCount = 0,
    onOpenNotifications,
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
    /** Rooms you own — offered under "Позвать в комнату" in the friend menu. */
    rooms?: OwnedRoom[];
    onGoHome: () => void;
    onOpenPeople: () => void;
    onOpenSettings: () => void;
    notificationsEnabled?: boolean;
    notificationsOpen?: boolean;
    notificationUnreadCount?: number;
    onOpenNotifications?: () => void;
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
  const selfPresence = $derived(
    normalizePresenceStatus(
      notificationPreferences.presenceStatus,
      notificationPreferences.doNotDisturb ? 'dnd' : 'online'
    )
  );
  const statusOptions = $derived<ReadonlyArray<{
    value: PresenceStatus;
    label: string;
    note?: string;
  }>>([
    { value: 'online', label: 'В сети' },
    {
      value: 'away',
      label: 'Отошёл',
      note: friendsState.automaticPresenceIdleAvailable
        ? 'Автоматически после 5 минут бездействия'
        : undefined
    },
    {
      value: 'dnd',
      label: 'Не беспокоить',
      note: 'Уведомления и звуковые сигналы будут отключены'
    },
    { value: 'offline', label: 'Не в сети' }
  ]);
  let statusSaving = $state<PresenceStatus | null>(null);
  let statusPopoverOpen = $state(false);
  let activeStatusIndex = $state(0);
  let statusOptionRefs: HTMLButtonElement[] = [];
  let statusTypeahead = '';
  let statusTypeaheadTimer: ReturnType<typeof setTimeout> | null = null;
  const selectedStatusIndex = $derived(
    Math.max(0, statusOptions.findIndex((option) => option.value === selfPresence))
  );
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

  async function focusStatusOption(index = selectedStatusIndex): Promise<void> {
    await tick();
    if (!statusPopoverOpen) return;
    const nextIndex = Math.min(Math.max(index, 0), statusOptions.length - 1);
    activeStatusIndex = nextIndex;
    statusOptionRefs[nextIndex]?.focus();
  }

  async function openStatusPopoverAndFocus(index = selectedStatusIndex): Promise<void> {
    activeStatusIndex = Math.min(Math.max(index, 0), statusOptions.length - 1);
    statusPopoverOpen = true;
    await focusStatusOption(activeStatusIndex);
  }

  function registerStatusOption(node: HTMLButtonElement, index: number) {
    statusOptionRefs[index] = node;
    return {
      update(nextIndex: number) {
        delete statusOptionRefs[index];
        index = nextIndex;
        statusOptionRefs[index] = node;
      },
      destroy() {
        delete statusOptionRefs[index];
      }
    };
  }

  function handleStatusTriggerClick(): void {
    if (statusPopoverOpen) {
      statusPopoverOpen = false;
      return;
    }
    void openStatusPopoverAndFocus(selectedStatusIndex);
  }

  function handleStatusTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      void openStatusPopoverAndFocus(selectedStatusIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      void openStatusPopoverAndFocus(selectedStatusIndex > 0 ? selectedStatusIndex : statusOptions.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openStatusPopoverAndFocus(selectedStatusIndex);
    }
  }

  function moveStatusFocus(delta: number): void {
    const nextIndex = (activeStatusIndex + delta + statusOptions.length) % statusOptions.length;
    void focusStatusOption(nextIndex);
  }

  function matchStatusTypeahead(char: string): void {
    if (statusTypeaheadTimer) clearTimeout(statusTypeaheadTimer);
    statusTypeahead += char.toLocaleLowerCase();
    statusTypeaheadTimer = setTimeout(() => {
      statusTypeahead = '';
      statusTypeaheadTimer = null;
    }, 700);

    const start = (activeStatusIndex + 1) % statusOptions.length;
    const ordered = [...statusOptions.slice(start), ...statusOptions.slice(0, start)];
    const matched = ordered.find((option) =>
      option.label.toLocaleLowerCase().startsWith(statusTypeahead)
    );
    if (!matched) return;
    void focusStatusOption(statusOptions.findIndex((option) => option.value === matched.value));
  }

  function handleStatusOptionKeydown(
    event: KeyboardEvent,
    status: PresenceStatus,
    close: (restoreFocus?: boolean) => void
  ): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveStatusFocus(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveStatusFocus(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      void focusStatusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      void focusStatusOption(statusOptions.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void selectStatus(status, close);
    } else if (event.key === 'Tab') {
      close(false);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      matchStatusTypeahead(event.key);
    }
  }

  async function selectStatus(status: PresenceStatus, close: () => void): Promise<void> {
    if (statusSaving) return;
    if (status === selfPresence && !notificationPreferences.presenceStatusAutomatic) {
      close();
      return;
    }
    statusSaving = status;
    try {
      await updatePresenceStatus(status);
      close();
    } catch {
      onToast('Не удалось изменить статус');
    } finally {
      statusSaving = null;
    }
  }
</script>

<aside class="lv-side">
  <button class="lv-side-head" type="button" title="Главная" onclick={onGoHome}>
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
        {@const friendPresence = effectivePresenceStatus(entry.online, entry.user.presenceStatus, entry.user.doNotDisturb)}
        {@const friendNotificationsMuted = notificationPreferences.mutedPeerIds.includes(entry.user.id)}
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
          <Avatar
            name={friendName(entry.user)}
            src={entry.user.avatarUrl}
            colorKey={entry.user.avatarColorKey}
            background={entry.user.avatarAccent || undefined}
            online={friendPresence === 'online'}
            afk={friendPresence === 'away'}
            dnd={friendPresence === 'dnd'}
            showDot
            ring="var(--panel)"
          />
          <div style="min-width:0;flex:1;">
            <div class="lv-notification-title">
              <div class="lv-row-name" style={`font-weight:${entry.unreadCount > 0 ? 750 : 650}`}>{friendName(entry.user)}</div>
              {#if friendNotificationsMuted}
                <span class="lv-notification-muted" role="img" aria-label="Уведомления отключены" title="Уведомления отключены">
                  <BellOff {...iconSm} aria-hidden="true" />
                </span>
              {/if}
            </div>
          </div>
          {#if entry.unreadCount > 0}
            <Badge tone={friendNotificationsMuted ? 'muted' : 'default'}>{entry.unreadCount}</Badge>
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
    <Popover bind:open={statusPopoverOpen} placement="top-start" role="listbox" ariaLabel="Статус пользователя" panelClass="lv-status-popover">
      {#snippet trigger({ open, panelId })}
        <button
          type="button"
          class="lv-profile-user"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={panelId}
          onclick={handleStatusTriggerClick}
          onkeydown={handleStatusTriggerKeydown}
        >
          <Avatar
            name={selfName}
            src={user.avatarUrl}
            colorKey={user.avatarColorKey}
            background={user.avatarAccent || undefined}
            size={34}
            online={selfPresence === 'online'}
            afk={selfPresence === 'away'}
            dnd={selfPresence === 'dnd'}
            showDot
            ring="var(--panel)"
          />
          <span style="min-width:0;flex:1;text-align:left;">
            <span class="lv-row-name" style="display:block;">{selfName}</span>
            <span class="lv-profile-handle" style="display:block;">@{user.login}</span>
          </span>
        </button>
      {/snippet}
      {#snippet content({ close })}
        <PopoverMenuLabel text="Статус" />
        <div class="lv-status-list">
          {#each statusOptions as option, index (option.value)}
            {@const selected = selfPresence === option.value}
            <button
              use:registerStatusOption={index}
              class="lv-status-option"
              class:is-selected={selected}
              type="button"
              role="option"
              aria-selected={selected}
              tabindex={index === activeStatusIndex ? 0 : -1}
              disabled={Boolean(statusSaving)}
              onclick={() => void selectStatus(option.value, close)}
              onkeydown={(event) => handleStatusOptionKeydown(event, option.value, close)}
              onfocus={() => (activeStatusIndex = index)}
            >
              <span class="lv-status-dot" data-status={option.value} aria-hidden="true"></span>
              <span class="lv-status-copy">
                <span class="lv-status-label">{option.label}</span>
                {#if option.note}<span class="lv-status-note">{option.note}</span>{/if}
              </span>
              {#if selected}<Check {...iconSm} class="lv-status-check" aria-hidden="true" />{/if}
            </button>
          {/each}
        </div>
      {/snippet}
    </Popover>
    <div class="lv-profile-actions">
      <SidebarDownload />
      {#if notificationsEnabled}
        <button
          class="lobby-gear lv-notification-button"
          type="button"
          title="Уведомления"
          aria-label="Открыть уведомления"
          aria-expanded={notificationsOpen}
          onclick={onOpenNotifications}
        >
          <Bell {...iconSm} aria-hidden="true" />
          {#if notificationUnreadCount > 0}
            <span class="lv-notification-count">{notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}</span>
          {/if}
        </button>
      {/if}
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
          {rooms}
          {close}
          canClose={(userId) => contextFriendId === userId}
          profileRestoreFocus={contextTrigger}
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

  .lv-notification-button { position: relative; }
  .lv-notification-count {
    position: absolute;
    top: -5px;
    right: -5px;
    display: grid;
    min-width: 17px;
    height: 17px;
    place-items: center;
    border: 2px solid var(--panel);
    border-radius: 999px;
    padding: 0 3px;
    background: var(--coral);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 9px;
    line-height: 1;
  }

  :global(.lv-status-popover) {
    width: min(286px, calc(100vw - 28px));
  }

  .lv-status-list {
    display: grid;
    gap: 2px;
  }

  .lv-status-option {
    display: grid;
    grid-template-columns: 11px minmax(0, 1fr) 18px;
    align-items: center;
    gap: 11px;
    width: 100%;
    min-height: 40px;
    padding: 8px 12px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--warm-ink-dim);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }

  /* Same accent wash the shared menu items use, so the status list reads as one
     family with every other menu. */
  .lv-status-option:hover,
  .lv-status-option:focus-visible,
  .lv-status-option.is-selected {
    background: color-mix(in oklch, var(--accent), transparent 88%);
    color: var(--warm-ink);
  }

  .lv-status-option:disabled {
    cursor: wait;
    opacity: 0.64;
  }

  .lv-status-dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--warm-faint);
  }

  .lv-status-dot[data-status='online'] { background: var(--green); }
  .lv-status-dot[data-status='away'] { background: var(--amber); }
  .lv-status-dot[data-status='dnd'] { background: var(--coral); }

  .lv-status-copy {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .lv-status-label {
    color: currentColor;
    font-size: 14.5px;
    font-weight: 600;
    line-height: 1.25;
  }

  .lv-status-note {
    max-width: 29ch;
    color: var(--warm-faint);
    font-size: 11px;
    line-height: 1.4;
  }

  :global(.lv-status-check) {
    color: var(--accent);
  }
</style>
