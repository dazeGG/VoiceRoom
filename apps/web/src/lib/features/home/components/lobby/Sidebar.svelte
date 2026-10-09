<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { Bell, BellOff, Check, Settings, UserPlus, Users } from '@lucide/svelte';
  import { tick } from 'svelte';
  import type { AuthUser } from '$lib/api/auth';
  import { Avatar, Badge, Button, Popover, PopoverMenuLabel } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import { effectivePresenceStatus, normalizePresenceStatus, type PresenceStatus } from '$lib/shared/presence';
  import { friendName } from '../../model/lobby-format';
  import { useLobby } from '$lib/features/home/model/lobby-context';
  import { notificationPreferences, updatePresenceStatus } from '$lib/shared/notifications/preferences.svelte';
  import SidebarDownload from '../SidebarDownload.svelte';
  import VoiceCallWidget from './VoiceCallWidget.svelte';

  const lobby = useLobby();

  let {
    user,
    onGoHome,
    onOpenPeople,
    onOpenSettings,
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
    onGoHome: () => void;
    onOpenPeople: () => void;
    onOpenSettings: () => void;
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
    [...lobby.friends].sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0))
  );

  const selfName = $derived(user.displayName?.trim() || user.login);
  const activeVoiceLabel = $derived(activeVoiceRoomName?.trim() || activeVoiceRoomId || '');
  const selfPresence = $derived(
    normalizePresenceStatus(
      notificationPreferences.presenceStatus,
      notificationPreferences.doNotDisturb ? 'dnd' : 'online'
    )
  );
  const statusOptions = $derived<
    ReadonlyArray<{
      value: PresenceStatus;
      label: string;
      note?: string;
    }>
  >([
    { value: 'online', label: 'В сети' },
    {
      value: 'away',
      label: 'Отошёл',
      note: lobby.automaticPresenceIdleAvailable ? 'Автоматически после 5 минут бездействия' : undefined
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
    Math.max(
      0,
      statusOptions.findIndex((option) => option.value === selfPresence)
    )
  );

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
    const matched = ordered.find((option) => option.label.toLocaleLowerCase().startsWith(statusTypeahead));
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
    <span class="lv-brand-mark" role="img" aria-label="Voice Room"></span>
    <span class="lv-brand-name">Voice Room</span>
  </button>

  <div class="lv-side-scroll">
    <div class="lv-sec-head">
      <span class="lv-sec-title"
        >Друзья{#if lobby.friends.length > 0}<span class="lv-sec-count">{lobby.friends.length}</span>{/if}</span
      >
      <div class="lv-sec-actions">
        <button class="lv-mini-btn" type="button" title="Заявки и добавить друга" onclick={onOpenPeople}>
          <UserPlus {...iconSm} aria-hidden="true" />
          {#if lobby.incomingRequestCount > 0}
            <span class="lv-mini-btn-dot"></span>
          {/if}
        </button>
      </div>
    </div>

    {#if lobby.friends.length === 0}
      <div class="lv-empty">
        <Users {...iconSm} aria-hidden="true" />
        <p>Пока нет друзей. Откройте «Заявки», чтобы добавить по логину.</p>
        <Button variant="soft" class="compact" onclick={onOpenPeople}>Добавить друга</Button>
      </div>
    {:else}
      {#each sortedFriends as entry (entry.user.id)}
        {@const friendPresence = effectivePresenceStatus(
          entry.online,
          entry.user.presenceStatus,
          entry.user.doNotDisturb
        )}
        {@const friendNotificationsMuted = notificationPreferences.mutedPeerIds.includes(entry.user.id)}
        <button
          class="lv-row"
          class:is-active={lobby.selectedFriendId === entry.user.id && lobby.view === 'dm'}
          type="button"
          onclick={() => lobby.openDm(entry.user.id)}
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
            size={30}
            ring="var(--vr-surface)"
          />
          <div class="lv-row-body">
            <div class="lv-notification-title">
              <div class="lv-row-name">
                <EmojiText text={friendName(entry.user)} />
              </div>
              {#if friendNotificationsMuted}
                <span
                  class="lv-notification-muted"
                  role="img"
                  aria-label="Уведомления отключены"
                  title="Уведомления отключены"
                >
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
    <Popover
      bind:open={statusPopoverOpen}
      placement="top-start"
      role="listbox"
      ariaLabel="Статус пользователя"
      panelClass="lv-status-popover"
    >
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
            size={32}
            online={selfPresence === 'online'}
            afk={selfPresence === 'away'}
            dnd={selfPresence === 'dnd'}
            showDot
            ring="var(--vr-surface)"
          />
          <span class="lv-profile-names">
            <span class="lv-profile-name"><EmojiText text={selfName} /></span>
            <span class="lv-profile-handle">@{user.login}</span>
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
      <button
        class="lobby-gear lv-notification-button"
        class:is-open={notificationsOpen}
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

<style>
  .lv-brand-mark {
    width: 22px;
    height: 22px;
    flex: none;
    background: var(--vr-accent);
    mask: url('/voiceroom-mascot.svg') center / contain no-repeat;
  }

  .lv-sec-title {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .lv-sec-count {
    color: var(--vr-text-3);
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 400;
  }

  .lv-row-body {
    flex: 1;
    min-width: 0;
  }

  .lv-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin: 4px 0;
    padding: 18px 14px;
    border: 1px dashed var(--vr-line-strong);
    border-radius: 14px;
    color: var(--vr-text-3);
    text-align: center;
  }

  .lv-empty p {
    margin: 0;
    color: var(--vr-text-2);
    font-size: 13px;
    line-height: 1.45;
  }

  .lv-profile-user {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 10px;
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .lv-profile-names {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    text-align: left;
  }

  .lv-profile-name {
    overflow: hidden;
    font-size: 14px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lv-profile-actions {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    margin-left: auto;
  }

  .lv-notification-button {
    position: relative;
  }
  .lv-notification-button.is-open {
    background: var(--vr-surface-3);
    color: var(--vr-text);
  }
  .lv-notification-count {
    position: absolute;
    top: -6px;
    right: -6px;
    box-sizing: content-box;
    display: grid;
    min-width: 10px;
    height: 14px;
    place-items: center;
    border: 2px solid var(--vr-surface);
    border-radius: 999px;
    padding: 0 2px;
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
    font-size: 9px;
    font-weight: 700;
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
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--vr-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background 140ms ease,
      color 140ms ease;
  }

  .lv-status-option:hover,
  .lv-status-option:focus-visible,
  .lv-status-option.is-selected {
    background: var(--vr-hover);
  }

  .lv-status-option:disabled {
    cursor: wait;
    opacity: 0.64;
  }

  .lv-status-dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--vr-offline);
  }

  .lv-status-dot[data-status='online'] {
    background: var(--vr-online);
  }
  .lv-status-dot[data-status='away'] {
    background: var(--vr-away);
  }
  .lv-status-dot[data-status='dnd'] {
    background: var(--vr-dnd);
  }

  .lv-status-copy {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .lv-status-label {
    color: currentColor;
    font-size: 14px;
    line-height: 1.25;
  }

  .lv-status-note {
    max-width: 29ch;
    color: var(--vr-text-3);
    font-size: 11.5px;
    line-height: 1.4;
  }

  :global(.lv-status-check) {
    color: var(--vr-accent);
  }
  :global(.lv-side) {
    width: var(--lv-side-w);
    flex: none;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--vr-surface);
    border-right: 1px solid var(--vr-line);
  }
  :global(.lv-side-head) {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 8px 4px;
    padding: 12px;
    flex: none;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
  }
  :where(.lv-side-head):hover {
    background: var(--vr-hover);
  }
  :where(.lv-side-head):focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: -2px;
  }
  :global(.lv-brand-name) {
    flex: 1;
    color: var(--vr-text);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  :global(.lv-side-scroll) {
    flex: 1;
    overflow: auto;
    padding: 4px 10px;
  }
  :global(.lv-sec-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 6px;
    color: var(--vr-text-2);
    font-size: 12.5px;
    font-weight: 500;
  }
  :global(.lv-sec-actions) {
    display: flex;
    gap: 2px;
  }
  :global(.lv-mini-btn) {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--vr-text-2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  :where(.lv-mini-btn):hover {
    background: var(--vr-hover);
    color: var(--vr-text);
  }
  :global(.lv-mini-btn-dot) {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--vr-accent);
    box-shadow: 0 0 0 2px var(--vr-surface);
  }
  :global(.lv-profile) {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-top: 1px solid var(--vr-line);
    flex: none;
  }
  :global(.lv-profile-handle) {
    color: var(--vr-text-3);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
</style>
