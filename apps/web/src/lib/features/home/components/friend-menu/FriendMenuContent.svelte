<script lang="ts">
  import { Ban, Bell, BellOff, MessageSquare, User, UserMinus, UserRoundPlus } from '@lucide/svelte';
  import type { Friend } from '$lib/api/friends';
  import type { OwnedRoom } from '$lib/api/auth';
  import {
    Avatar,
    Ellipsis,
    PopoverDivider,
    PopoverMenuItem,
    PopoverSubmenu
  } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import { effectivePresenceStatus } from '$lib/shared/presence';
  import { friendName } from '../../model/lobby-format';
  import { blockUser, openDm, removeFriend } from '../../model/friends.svelte';
  import { openProfileCardFor } from '../../profile-card-ui.svelte';
  import { ringRoomFriend } from '$lib/api/rooms';
  import { roomDisplayName } from '../../model/rooms';
  import {
    isPeerNotificationsMuted,
    updatePeerNotificationsMuted
  } from '$lib/shared/notifications/preferences.svelte';

  let { friend, rooms = [], close, canClose, profileRestoreFocus = null, onToast } = $props<{
    friend: Friend;
    /** Rooms you own, offered under "Позвать в комнату". */
    rooms?: OwnedRoom[];
    close: (restoreFocus?: boolean) => void;
    canClose?: (userId: string) => boolean;
    profileRestoreFocus?: HTMLElement | null;
    onToast?: (message: string) => void;
  }>();

  const name = $derived(friendName(friend.user));
  const muted = $derived(isPeerNotificationsMuted(friend.user.id));
  const presence = $derived(
    effectivePresenceStatus(friend.online, friend.user.presenceStatus, friend.user.doNotDisturb)
  );
  let busy = $state(false);
  let confirmingBlock = $state(false);

  // The menu instance is reused across friends; a stale confirm state would
  // otherwise carry a destructive prompt onto the next person.
  $effect(() => {
    friend.user.id;
    confirmingBlock = false;
  });

  function stillCurrent(): boolean {
    return canClose?.(friend.user.id) ?? true;
  }

  async function run(action: () => Promise<void>, failure: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await action();
    } catch (error) {
      // Actions such as opening a DM, removing and blocking intentionally close
      // the menu before awaiting. Their failures must still reach the app-level
      // toast stack after this menu instance is gone.
      onToast?.(error instanceof Error && error.message ? error.message : failure);
    } finally {
      busy = false;
    }
  }

  function openConversation(): void {
    const userId = friend.user.id;
    close(false);
    void run(() => openDm(userId), 'Не удалось открыть диалог');
  }

  function showProfile(event: MouseEvent): void {
    const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const anchorRect = anchor?.getBoundingClientRect() ?? null;
    const person = {
      userId: friend.user.id,
      name,
      login: friend.user.login,
      avatarUrl: friend.user.avatarUrl,
      avatarColorKey: friend.user.avatarColorKey,
      avatarAccent: friend.user.avatarAccent,
      presence
    };
    close(false);
    queueMicrotask(() => openProfileCardFor(person, { rect: anchorRect, restoreFocus: profileRestoreFocus }));
  }

  function invite(roomId: string, roomName: string, closeSubmenu: () => void): void {
    const userId = friend.user.id;
    void run(async () => {
      await ringRoomFriend(roomId, userId);
      onToast?.(`${name} приглашён в «${roomName}»`);
      closeSubmenu();
      close();
    }, 'Не удалось позвать в комнату');
  }

  function toggleMute(): void {
    const targetUserId = friend.user.id;
    const nextMuted = !muted;
    void run(async () => {
      await updatePeerNotificationsMuted(targetUserId, nextMuted);
      if (stillCurrent()) close();
    }, 'Не удалось изменить уведомления');
  }

  function remove(): void {
    const userId = friend.user.id;
    close(false);
    void run(async () => {
      await removeFriend(userId);
      onToast?.(`${name} удалён из друзей`);
    }, 'Не удалось удалить друга');
  }

  function block(): void {
    const userId = friend.user.id;
    close(false);
    void run(async () => {
      await blockUser(userId);
      onToast?.(`${name} заблокирован`);
    }, 'Не удалось заблокировать');
  }
</script>

<div class="friend-menu-content" data-friend-menu-content>
  <div class="friend-menu-head">
    <Avatar
      {name}
      src={friend.user.avatarUrl}
      colorKey={friend.user.avatarColorKey}
      background={friend.user.avatarAccent || undefined}
      size={44}
      online={presence === 'online'}
      afk={presence === 'away'}
      dnd={presence === 'dnd'}
      showDot
      ring="var(--warm-800)"
    />
    <div class="friend-menu-info">
      <Ellipsis class="friend-menu-name" text={name} />
      <Ellipsis class="friend-menu-handle" text={`@${friend.user.login}`} />
    </div>
  </div>

  <PopoverDivider />

  <PopoverMenuItem label="Написать" disabled={busy} onclick={openConversation}>
    {#snippet icon()}<MessageSquare {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>

  {#if rooms.length > 0}
    <PopoverSubmenu label="Позвать в комнату" ariaLabel={`Позвать ${name} в комнату`} disabled={busy}>
      {#snippet icon()}<UserRoundPlus {...iconMd} aria-hidden="true" />{/snippet}
      {#snippet content({ close: closeSubmenu })}
        {#each rooms as room (room.roomId)}
          {@const label = roomDisplayName(room)}
          <PopoverMenuItem
            label={label}
            disabled={busy}
            onclick={() => invite(room.roomId, label, closeSubmenu)}
          >
            {#snippet icon()}
              <Avatar
                name={label}
                src={room.avatarUrl}
                shape="squircle"
                background="var(--room-avatar-bg)"
                size={26}
              />
            {/snippet}
          </PopoverMenuItem>
        {/each}
      {/snippet}
    </PopoverSubmenu>
  {/if}

  <PopoverMenuItem label="Профиль" disabled={busy} onclick={showProfile}>
    {#snippet icon()}<User {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>

  <PopoverDivider />

  <PopoverMenuItem
    label={muted ? 'Включить уведомления' : 'Выключить уведомления'}
    disabled={busy}
    onclick={toggleMute}
  >
    {#snippet icon()}
      {#if muted}<BellOff {...iconMd} aria-hidden="true" />{:else}<Bell {...iconMd} aria-hidden="true" />{/if}
    {/snippet}
  </PopoverMenuItem>

  <PopoverDivider />

  <PopoverMenuItem label="Удалить из друзей" variant="danger" disabled={busy} onclick={remove}>
    {#snippet icon()}<UserMinus {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>

  {#if confirmingBlock}
    <div class="friend-menu-confirm">
      <p class="friend-menu-confirm-text">
        {name} больше не сможет писать вам и звать в комнаты. Дружба будет разорвана.
      </p>
      <div class="friend-menu-confirm-actions">
        <button type="button" class="friend-menu-ghost" disabled={busy} onclick={() => (confirmingBlock = false)}>
          Отмена
        </button>
        <button type="button" class="friend-menu-danger" disabled={busy} onclick={block}>
          Заблокировать
        </button>
      </div>
    </div>
  {:else}
    <PopoverMenuItem
      label="Заблокировать"
      variant="danger"
      disabled={busy}
      onclick={() => (confirmingBlock = true)}
    >
      {#snippet icon()}<Ban {...iconMd} aria-hidden="true" />{/snippet}
    </PopoverMenuItem>
  {/if}
</div>

<style>
  .friend-menu-content {
    display: flex;
    width: min(286px, calc(100vw - 28px));
    max-width: 100%;
    flex-direction: column;
    gap: 2px;
  }

  .friend-menu-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px 12px;
  }

  .friend-menu-info {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
  }

  :global(.friend-menu-name) {
    color: var(--warm-ink);
    font-size: 16px;
    font-weight: 800;
  }

  :global(.friend-menu-handle) {
    color: var(--warm-muted-dim);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .friend-menu-confirm {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 6px 12px 10px;
  }

  .friend-menu-confirm-text {
    margin: 0;
    color: var(--warm-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .friend-menu-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .friend-menu-ghost,
  .friend-menu-danger {
    height: 34px;
    padding: 0 13px;
    border: 0;
    border-radius: 11px;
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .friend-menu-ghost {
    background: transparent;
    color: var(--warm-muted);
  }

  .friend-menu-danger {
    background: var(--coral);
    color: #fff;
  }

  .friend-menu-ghost:disabled,
  .friend-menu-danger:disabled {
    cursor: default;
    opacity: 0.6;
  }
</style>
