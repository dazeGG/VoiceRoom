<script lang="ts">
  import { BellOff, ChevronRight, Plus, ShieldCheck, UserPlus, X } from '@lucide/svelte';
  import { Avatar, AvatarStack, Badge, Button, ContextMenu, Ellipsis, MascotIcon } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import type { OwnedRoom } from '$lib/api/auth';
  import { roomPresence } from '../../../../entities/room/room-presence.svelte';
  import { roomPeerAvatarItems } from '../../model/room-avatars';
  import { roomDisplayName } from '../../model/rooms';
  import { useLobby } from '$lib/features/home/model/lobby-context';
  import { notificationPreferences } from '$lib/shared/notifications/preferences.svelte';
  import { RoomMenuContent } from '$lib/shared/components/room-menu';

  const lobby = useLobby();

  let {
    rooms,
    onOpenRoom,
    onCreateRoom,
    onJoinCode,
    onRoomsChanged,
    onOpenRoomSettings,
    recoveryCodesReminder = false,
    onOpenRecoveryCodes = () => {},
    onSnoozeRecoveryCodes = () => {},
    onToast
  } = $props<{
    rooms: OwnedRoom[];
    onOpenRoom: (roomId: string) => void;
    onCreateRoom: () => void;
    onJoinCode: (code: string) => void;
    onRoomsChanged?: () => void;
    onOpenRoomSettings?: (roomId: string) => void;
    recoveryCodesReminder?: boolean;
    onOpenRecoveryCodes?: () => void;
    onSnoozeRecoveryCodes?: () => void;
    onToast?: (message: string) => void;
  }>();

  let joinCode = $state('');
  let contextRoomId = $state('');
  let contextX = $state(0);
  let contextY = $state(0);
  let contextTrigger = $state<HTMLElement | null>(null);

  const requestCount = $derived(lobby.incomingRequestCount);
  const sortedRooms = $derived([...rooms].sort((a: OwnedRoom, b: OwnedRoom) => b.peers - a.peers));
  const contextRoom = $derived(rooms.find((room: OwnedRoom) => room.roomId === contextRoomId));

  function roomAvatars(roomId: string) {
    return roomPeerAvatarItems(roomPresence.peersByRoomId[roomId] || []);
  }

  // Friends already in the room render disabled in the invite submenu.
  function roomPresentUserIds(roomId: string): Set<string> {
    const peers = roomPresence.peersByRoomId[roomId] || [];
    return new Set(
      peers
        .map((peer: { accountUserId?: string }) => peer.accountUserId || '')
        .filter((userId: string) => userId !== '')
    );
  }

  function roomUnreadCount(room: OwnedRoom): number {
    return roomPresence.unreadCountByRoomId[room.roomId] ?? room.unreadCount ?? 0;
  }

  function submitJoinCode(event: Event): void {
    event.preventDefault();
    if (!joinCode.trim()) return;
    onJoinCode(joinCode);
    joinCode = '';
  }

  function openRoomContextMenu(event: MouseEvent, roomId: string): void {
    event.preventDefault();
    event.stopPropagation();
    contextRoomId = roomId;
    contextX = event.clientX;
    contextY = event.clientY;
    contextTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  }

  function handleRoomKeydown(event: KeyboardEvent, roomId: string): void {
    const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!isContextKey || !(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    contextRoomId = roomId;
    contextX = rect.left + Math.min(rect.width - 12, 56);
    contextY = rect.top + Math.min(rect.height - 8, 44);
    contextTrigger = event.currentTarget;
  }

  function closeRoomContextMenu(): void {
    contextRoomId = '';
  }
</script>

<div class="lv-main-scroll">
  <h1 class="lr-title">Комнаты</h1>

  {#if requestCount > 0}
    <button class="lr-callout" type="button" onclick={lobby.showPeople}>
      <span class="lr-callout-icon">
        <UserPlus {...iconMd} aria-hidden="true" />
      </span>
      <div style="flex:1;min-width:0;">
        <div class="lr-callout-title">
          {requestCount}
          {requestCount === 1 ? 'новая заявка' : 'новые заявки'} в друзья
        </div>
        <div class="lr-callout-sub">Откройте, чтобы принять или отклонить</div>
      </div>
      <span style="flex:none;color:var(--warm-faint);">
        <ChevronRight {...iconMd} aria-hidden="true" />
      </span>
    </button>
  {/if}

  {#if recoveryCodesReminder}
    <div class="lr-callout lr-callout--split">
      <button class="lr-callout-main" type="button" onclick={onOpenRecoveryCodes}>
        <span class="lr-callout-icon">
          <ShieldCheck {...iconMd} aria-hidden="true" />
        </span>
        <div style="flex:1;min-width:0;">
          <div class="lr-callout-title">Защитите аккаунт</div>
          <div class="lr-callout-sub">Создайте коды восстановления — без них забытый пароль не вернуть</div>
        </div>
        <span style="flex:none;color:var(--warm-faint);">
          <ChevronRight {...iconMd} aria-hidden="true" />
        </span>
      </button>
      <button
        class="lr-callout-dismiss"
        type="button"
        aria-label="Напомнить через 3 дня"
        title="Напомнить через 3 дня"
        onclick={onSnoozeRecoveryCodes}
      >
        <X {...iconSm} aria-hidden="true" />
      </button>
    </div>
  {/if}

  <div
    style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin:24px 0 18px;"
  >
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
      <!-- A room code, not a credential: browsers and password managers
           (1Password, LastPass, Bitwarden) must not offer logins here. -->
      <form class="lv-join" onsubmit={submitJoinCode}>
        <input
          class="lv-join-input"
          placeholder="Код или ссылка"
          aria-label="Код или ссылка на комнату"
          aria-describedby="roomAutoSaveHint"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          bind:value={joinCode}
        />
        <span class="lv-join-hint" title="Постоянные комнаты сохраняются автоматически" aria-hidden="true">i</span>
        <span class="lv-sr-only" id="roomAutoSaveHint">Постоянные комнаты сохраняются автоматически</span>
        <button class="lv-join-btn" type="submit">Войти</button>
      </form>
      <Button variant="primary" onclick={onCreateRoom}>
        {#snippet icon()}<Plus {...iconSm} aria-hidden="true" />{/snippet}
        Создать комнату
      </Button>
    </div>
  </div>

  {#if rooms.length === 0}
    <div class="lr-empty-state">
      <MascotIcon variant="blink" size={32} />
      <p class="lr-empty">У вас пока нет комнат — создайте первую кнопкой выше.</p>
    </div>
  {:else}
    <div class="lv-cards">
      {#each sortedRooms as room (room.roomId)}
        {@const roomNotificationsMuted = notificationPreferences.mutedRoomIds.includes(room.roomId)}
        {@const unreadCount = roomUnreadCount(room)}
        <button
          class="lv-card"
          class:is-live={room.peers > 0}
          class:is-context={contextRoomId === room.roomId}
          type="button"
          onclick={() => onOpenRoom(room.roomId)}
          oncontextmenu={(event) => openRoomContextMenu(event, room.roomId)}
          onkeydown={(event) => handleRoomKeydown(event, room.roomId)}
          aria-haspopup="menu"
          class:has-unread={unreadCount > 0}
        >
          <div class="lv-card-head">
            <Avatar
              name={roomDisplayName(room)}
              src={room.avatarUrl}
              shape="squircle"
              background="var(--room-avatar-bg)"
              size={42}
            />
            <div style="min-width:0;flex:1;">
              <div class="lv-notification-title">
                <Ellipsis text={roomDisplayName(room)} class="lv-row-name" tag="div" />
                {#if roomNotificationsMuted}
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
          </div>
          {#if unreadCount > 0}
            <Badge class="lv-card-unread" tone={roomNotificationsMuted ? 'muted' : 'default'}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          {/if}
          <div class="lv-card-foot">
            {#if room.peers > 0}
              <span style="display:flex;align-items:center;gap:8px;"
                ><span class="lr-livedot"></span><AvatarStack
                  items={roomAvatars(room.roomId)}
                  maxAvatars={5}
                  size={24}
                  ariaLabel="В комнате"
                /></span
              >
            {:else}
              <span class="lv-row-sub">тихо сейчас</span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if contextRoom}
  <ContextMenu
    open={Boolean(contextRoomId)}
    x={contextX}
    y={contextY}
    ariaLabel={`Меню комнаты ${roomDisplayName(contextRoom)}`}
    restoreFocus={contextTrigger}
    onClose={closeRoomContextMenu}
  >
    {#snippet content({ close })}
      {#key contextRoom.roomId}
        <RoomMenuContent
          roomId={contextRoom.roomId}
          name={roomDisplayName(contextRoom)}
          avatarUrl={contextRoom.avatarUrl}
          relationship={contextRoom.relationship}
          friends={lobby.friends}
          presentUserIds={roomPresentUserIds(contextRoom.roomId)}
          {close}
          canClose={(roomId) => contextRoomId === roomId}
          onOpenSettings={contextRoom.relationship === 'owner'
            ? () => onOpenRoomSettings?.(contextRoom.roomId)
            : undefined}
          {onRoomsChanged}
          {onToast}
        />
      {/key}
    {/snippet}
  </ContextMenu>
{/if}

<style>
  :global(.lv-row-sub) {
    font-size: var(--lv-sub);
    color: var(--warm-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.lv-card-unread) {
    position: absolute;
    top: 16px;
    right: 16px;
  }
  :global(.lv-card-foot) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  :global(.lv-join-hint) {
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 18px;
    height: 18px;
    margin-right: 10px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 999px;
    color: var(--warm-muted);
    cursor: help;
    font-family: var(--font-ui);
    font-size: 12px;
    font-style: italic;
    line-height: 1;
  }
  :global(.lv-sr-only) {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  :global(.lr-empty-state) {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }
  :global(.lr-livedot) {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--green), transparent 78%);
    flex: none;
  }
  :global(.lr-callout) {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    margin-top: 22px;
    padding: 14px 16px;
    border: 1px solid color-mix(in oklch, var(--accent), transparent 60%);
    border-radius: var(--radius-lg);
    background: color-mix(in oklch, var(--accent), transparent 92%);
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  :where(.lr-callout):hover {
    background: color-mix(in oklch, var(--accent), transparent 86%);
  }
  :global(.lr-callout-icon) {
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: var(--radius-md);
    background: color-mix(in oklch, var(--accent), transparent 78%);
    color: var(--accent-ink);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  :global(.lr-callout-title) {
    font-size: 14px;
    font-weight: 700;
    color: var(--warm-ink);
  }
  :global(.lr-callout-sub) {
    font-size: 12px;
    color: var(--warm-muted);
    margin-top: 1px;
  }
  :where(.lr-callout) + .lr-callout {
    margin-top: 10px;
  }
  :global(.lr-callout--split) {
    gap: 0;
    padding: 0;
    cursor: default;
  }
  :where(.lr-callout--split):hover {
    background: color-mix(in oklch, var(--accent), transparent 92%);
  }
  :where(.lr-callout--split):has(.lr-callout-main:hover) {
    background: color-mix(in oklch, var(--accent), transparent 86%);
  }
  :global(.lr-callout-main) {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 14px;
    min-width: 0;
    padding: 14px 8px 14px 16px;
    border: none;
    border-radius: inherit;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  :global(.lr-callout-dismiss) {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    margin-right: 12px;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--warm-faint);
    cursor: pointer;
  }
  :where(.lr-callout-dismiss):hover {
    background: var(--control);
    color: var(--warm-ink);
  }
</style>
