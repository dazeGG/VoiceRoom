<script lang="ts">
  import { BellOff, Plus, ShieldCheck, UserPlus, X } from '@lucide/svelte';
  import { Avatar, AvatarStack, Badge, Button, ContextMenu, Ellipsis } from '$lib/shared/ui';
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
  // The request banner can be hidden until another request arrives.
  let dismissedRequestCount = $state(0);

  const requestCount = $derived(lobby.incomingRequestCount);
  const showRequestBanner = $derived(requestCount > dismissedRequestCount);
  const sortedRooms = $derived([...rooms].sort((a: OwnedRoom, b: OwnedRoom) => b.peers - a.peers));
  const liveRooms = $derived(sortedRooms.filter((room: OwnedRoom) => room.peers > 0));
  const quietRooms = $derived(sortedRooms.filter((room: OwnedRoom) => room.peers === 0));
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

  function dismissRequestBanner(): void {
    dismissedRequestCount = requestCount;
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
  <div class="lv-home">
    <div class="lv-home-head">
      <h1 class="lr-title">Комнаты</h1>
      <div class="lv-home-actions">
        <!-- A room code, not a credential. iCloud Passwords ignores
           autocomplete="off" and offered its logins here, over the room list;
           a search field is the one kind it leaves alone. The data-* skip
           attributes do the same for 1Password, LastPass and Bitwarden. -->
        <form class="lv-join" onsubmit={submitJoinCode}>
          <input
            class="lv-join-input"
            type="search"
            name="room-search"
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
          <span class="lv-sr-only" id="roomAutoSaveHint">Постоянные комнаты сохраняются автоматически</span>
          <button class="lv-join-btn" type="submit" title="Постоянные комнаты сохраняются автоматически">Войти</button>
        </form>
        <Button variant="primary" size="lg" onclick={onCreateRoom}>
          {#snippet icon()}<Plus {...iconSm} aria-hidden="true" />{/snippet}
          Создать комнату
        </Button>
      </div>
    </div>

    {#if recoveryCodesReminder}
      <div class="lr-callout">
        <button class="lr-callout-main" type="button" onclick={onOpenRecoveryCodes}>
          <span class="lr-callout-icon lr-callout-icon--warning">
            <ShieldCheck {...iconMd} aria-hidden="true" />
          </span>
          <span class="lr-callout-copy">
            <span class="lr-callout-title">Защитите аккаунт</span>
            <span class="lr-callout-sub">Создайте коды восстановления — без них забытый пароль не вернуть</span>
          </span>
        </button>
        <Button variant="outline" class="compact" onclick={onOpenRecoveryCodes}>Создать коды</Button>
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

    {#if showRequestBanner}
      <div class="lr-callout lr-callout--request">
        <span class="lr-callout-icon">
          <UserPlus {...iconMd} aria-hidden="true" />
        </span>
        <span class="lr-callout-copy">
          <span class="lr-callout-title">
            {requestCount}
            {requestCount === 1 ? 'новая заявка' : 'новые заявки'} в друзья
          </span>
          <span class="lr-callout-sub">Откройте, чтобы принять или отклонить</span>
        </span>
        <Button variant="primary" class="compact" onclick={lobby.showPeople}>Открыть</Button>
        <button
          class="lr-callout-dismiss"
          type="button"
          aria-label="Скрыть"
          title="Скрыть"
          onclick={dismissRequestBanner}
        >
          <X {...iconSm} aria-hidden="true" />
        </button>
      </div>
    {/if}

    {#if rooms.length === 0}
      <div class="lr-empty-state">
        <span class="lr-empty-mark" aria-hidden="true"></span>
        <p class="lr-empty">У вас пока нет комнат — создайте первую кнопкой выше.</p>
      </div>
    {/if}

    {#snippet roomName(room: OwnedRoom, muted: boolean)}
      <Ellipsis text={roomDisplayName(room)} class="lv-row-name" tag="span" />
      {#if muted}
        <span class="lv-notification-muted" role="img" aria-label="Уведомления отключены" title="Уведомления отключены">
          <BellOff {...iconSm} aria-hidden="true" />
        </span>
      {/if}
    {/snippet}

    {#if liveRooms.length > 0}
      <section class="lv-section" aria-label="Сейчас в эфире">
        <h2 class="lv-section-title"><span class="lr-livedot"></span>Сейчас в эфире</h2>
        <div class="lv-cards">
          {#each liveRooms as room (room.roomId)}
            {@const roomNotificationsMuted = notificationPreferences.mutedRoomIds.includes(room.roomId)}
            {@const unreadCount = roomUnreadCount(room)}
            <button
              class="lv-card"
              class:is-context={contextRoomId === room.roomId}
              class:has-unread={unreadCount > 0}
              type="button"
              onclick={() => onOpenRoom(room.roomId)}
              oncontextmenu={(event) => openRoomContextMenu(event, room.roomId)}
              onkeydown={(event) => handleRoomKeydown(event, room.roomId)}
              aria-haspopup="menu"
            >
              <span class="lv-card-head">
                <Avatar
                  name={roomDisplayName(room)}
                  src={room.avatarUrl}
                  shape="squircle"
                  background="var(--vr-surface-3)"
                  foreground="var(--vr-text)"
                  size={40}
                />
                {@render roomName(room, roomNotificationsMuted)}
                <span class="lv-spacer"></span>
                {#if unreadCount > 0}
                  <Badge tone={roomNotificationsMuted ? 'muted' : 'default'}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                {/if}
              </span>
              <span class="lv-card-foot">
                <span class="lr-livedot"></span>
                <AvatarStack items={roomAvatars(room.roomId)} maxAvatars={5} size={24} ariaLabel="В комнате" />
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if quietRooms.length > 0}
      <section class="lv-section lv-section--quiet" aria-label="Остальные">
        <h2 class="lv-section-title">Остальные</h2>
        <div class="lv-quiet-list">
          {#each quietRooms as room (room.roomId)}
            {@const roomNotificationsMuted = notificationPreferences.mutedRoomIds.includes(room.roomId)}
            {@const unreadCount = roomUnreadCount(room)}
            <button
              class="lv-card lv-card--quiet"
              class:is-context={contextRoomId === room.roomId}
              class:has-unread={unreadCount > 0}
              type="button"
              onclick={() => onOpenRoom(room.roomId)}
              oncontextmenu={(event) => openRoomContextMenu(event, room.roomId)}
              onkeydown={(event) => handleRoomKeydown(event, room.roomId)}
              aria-haspopup="menu"
            >
              <Avatar
                name={roomDisplayName(room)}
                src={room.avatarUrl}
                shape="squircle"
                background="var(--vr-surface-3)"
                foreground="var(--vr-text-2)"
                size={32}
              />
              {@render roomName(room, roomNotificationsMuted)}
              <span class="lv-spacer"></span>
              {#if unreadCount > 0}
                <Badge tone={roomNotificationsMuted ? 'muted' : 'default'}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
              {/if}
              <span class="lv-row-sub">тихо</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}
  </div>
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
  .lv-home {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .lv-home-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .lv-home-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .lv-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .lv-section--quiet {
    gap: 4px;
  }

  .lv-section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--vr-text-2);
    font-size: 13px;
    font-weight: 500;
  }

  .lv-section--quiet .lv-section-title {
    padding-bottom: 8px;
  }

  .lv-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }

  .lv-card {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px;
    border: 1px solid var(--vr-line);
    border-radius: 16px;
    background: var(--vr-surface-2);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  .lv-card:hover,
  .lv-card.is-context {
    border-color: var(--vr-accent-line);
  }

  .lv-card:focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: 2px;
  }

  .lv-card-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .lv-card-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
  }

  .lv-spacer {
    flex: 1;
  }

  .lv-quiet-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .lv-card--quiet {
    flex-direction: row;
    align-items: center;
    gap: 12px;
    height: 50px;
    padding: 0 12px;
    border-color: transparent;
    border-radius: 12px;
    background: transparent;
  }

  .lv-card--quiet:hover,
  .lv-card--quiet.is-context {
    border-color: transparent;
    background: var(--vr-hover);
  }

  :global(.lv-card .lv-row-name) {
    flex: 0 1 auto;
    min-width: 0;
    font-size: 15px;
  }

  :global(.lv-card--quiet .lv-row-name) {
    font-size: 14px;
  }

  :global(.lv-row-sub) {
    width: 56px;
    color: var(--vr-text-3);
    font-size: 12.5px;
    text-align: right;
    white-space: nowrap;
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

  :global(.lr-title) {
    margin: 0;
    color: var(--vr-text);
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.025em;
  }

  :global(.lr-empty) {
    margin: 0;
    color: var(--vr-text-2);
    font-size: 14.5px;
    line-height: 1.5;
  }

  .lr-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 56px 24px;
    border: 1px dashed var(--vr-line-strong);
    border-radius: 20px;
    text-align: center;
  }

  .lr-empty-state .lr-empty {
    max-width: 340px;
  }

  .lr-empty-mark {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 17px;
    background: var(--vr-surface-2);
  }

  .lr-empty-mark::after {
    content: '';
    position: absolute;
    inset: 13px;
    background: var(--vr-accent);
    mask: url('/voiceroom-mascot.svg') center / contain no-repeat;
  }

  :global(.lr-livedot) {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--vr-accent);
    box-shadow: 0 0 0 3px var(--vr-accent-soft);
  }

  :global(.lr-callout) {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 14px 14px 16px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 14px;
    background: var(--vr-surface-2);
  }

  :global(.lr-callout--request) {
    border-color: var(--vr-accent-line);
    background: var(--vr-accent-soft);
  }

  :global(.lr-callout-icon) {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
  }

  :global(.lr-callout-icon--warning) {
    background: color-mix(in oklch, var(--vr-warning), transparent 86%);
    color: var(--vr-warning);
  }

  :global(.lr-callout-main) {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 14px;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  :global(.lr-callout-copy) {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  :global(.lr-callout-title) {
    color: var(--vr-text);
    font-size: 14.5px;
    font-weight: 600;
  }

  :global(.lr-callout-sub) {
    color: var(--vr-text-2);
    font-size: 13px;
  }

  :global(.lr-callout-dismiss) {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--vr-text-2);
    cursor: pointer;
  }

  :where(.lr-callout-dismiss):hover {
    background: var(--vr-hover);
    color: var(--vr-text);
  }
</style>
