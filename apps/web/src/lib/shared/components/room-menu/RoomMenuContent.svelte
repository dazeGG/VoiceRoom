<script lang="ts">
  import { Bell, BellOff, Copy, Link, Settings, Trash2, UserRoundPlus } from '@lucide/svelte';
  import type { RoomRelationship } from '$lib/api/auth';
  import type { Friend } from '$lib/api/friends';
  import { removeRoomFromList } from '$lib/api/auth';
  import { Avatar, Ellipsis, PopoverDivider, PopoverMenuItem, PopoverMenuLabel, PopoverSubmenu } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import { copyText } from '$lib/shared/utils/clipboard';
  import {
    isRoomNotificationsMuted,
    updateRoomNotificationsMuted
  } from '$lib/shared/notifications/preferences.svelte';
  import RoomInviteFriendList from './RoomInviteFriendList.svelte';

  let {
    roomId,
    name,
    avatarUrl = null,
    relationship = 'owner',
    friends,
    presentUserIds = new Set<string>(),
    close,
    canClose,
    onOpenSettings,
    inviteContent,
    onRoomsChanged,
    onToast,
    showNotificationControls = true
  } = $props<{
    roomId: string;
    name: string;
    avatarUrl?: string | null;
    relationship?: RoomRelationship;
    friends?: Friend[];
    presentUserIds?: Set<string>;
    close: (restoreFocus?: boolean) => void;
    canClose?: (roomId: string) => boolean;
    onOpenSettings?: () => void;
    inviteContent?: import('svelte').Snippet<[close: () => void]>;
    onRoomsChanged?: () => void;
    onToast?: (message: string) => void;
    showNotificationControls?: boolean;
  }>();

  const roomMuted = $derived(isRoomNotificationsMuted(roomId));
  const isOwner = $derived(relationship === 'owner');
  let muteSaving = $state(false);
  let removeSaving = $state(false);

  function stillCurrent(targetRoomId: string): boolean {
    return canClose?.(targetRoomId) ?? true;
  }

  function openSettings(): void {
    close(false);
    onOpenSettings?.();
  }

  async function copyValue(value: string, successMessage: string): Promise<void> {
    const targetRoomId = roomId;
    try {
      await copyText(value);
      if (!stillCurrent(targetRoomId)) return;
      onToast?.(successMessage);
    } catch {
      if (!stillCurrent(targetRoomId)) return;
      onToast?.('Не удалось скопировать');
    }
    if (stillCurrent(targetRoomId)) close();
  }

  async function toggleRoomMute(): Promise<void> {
    if (!showNotificationControls) return;
    if (muteSaving) return;
    muteSaving = true;
    const targetRoomId = roomId;
    const nextMuted = !roomMuted;
    try {
      await updateRoomNotificationsMuted(targetRoomId, nextMuted);
      if (stillCurrent(targetRoomId)) close();
    } catch {
      if (stillCurrent(targetRoomId)) onToast?.('Не удалось изменить уведомления');
    } finally {
      muteSaving = false;
    }
  }

  async function removeBookmark(): Promise<void> {
    if (isOwner || removeSaving) return;
    removeSaving = true;
    const targetRoomId = roomId;
    try {
      await removeRoomFromList(targetRoomId);
      if (!stillCurrent(targetRoomId)) return;
      onToast?.(`Комната «${name}» удалена из списка`);
      close(false);
      onRoomsChanged?.();
    } catch (error) {
      if (stillCurrent(targetRoomId)) {
        onToast?.(error instanceof Error && error.message ? error.message : 'Не удалось удалить комнату из списка');
      }
    } finally {
      removeSaving = false;
    }
  }
</script>

<div class="room-menu-content" data-room-menu-content>
  <div class="room-menu-head">
    <Avatar {name} src={avatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={44} />
    <div class="room-menu-info">
      <Ellipsis class="room-menu-name" text={name} />
      <Ellipsis class="room-menu-code" text={roomId} />
    </div>
  </div>

  <PopoverDivider />
  <PopoverMenuLabel text="Комната" />

  {#if inviteContent}
    <PopoverSubmenu label="Пригласить" ariaLabel={`Позвать друга в ${name}`}>
      {#snippet icon()}<UserRoundPlus {...iconMd} aria-hidden="true" />{/snippet}
      {#snippet content()}{@render inviteContent(close)}{/snippet}
    </PopoverSubmenu>
  {:else if friends}
    <PopoverSubmenu label="Пригласить" ariaLabel={`Позвать друга в ${name}`}>
      {#snippet icon()}<UserRoundPlus {...iconMd} aria-hidden="true" />{/snippet}
      {#snippet content({ close: closeSubmenu })}
        <RoomInviteFriendList
          {friends}
          {roomId}
          {presentUserIds}
          {onToast}
          close={() => {
            closeSubmenu();
            close();
          }}
        />
      {/snippet}
    </PopoverSubmenu>
  {/if}

  <PopoverMenuItem label="Скопировать код" onclick={() => void copyValue(roomId, 'Код скопирован')}>
    {#snippet icon()}<Copy {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>

  <PopoverMenuItem
    label="Скопировать ссылку"
    onclick={() => void copyValue(`${window.location.origin}/r/${encodeURIComponent(roomId)}`, 'Ссылка скопирована')}
  >
    {#snippet icon()}<Link {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>

  {#if showNotificationControls}
    <PopoverDivider />
    <PopoverMenuItem
      label={roomMuted ? 'Включить уведомления' : 'Выключить уведомления'}
      onclick={() => void toggleRoomMute()}
      disabled={muteSaving}
    >
      {#snippet icon()}
        {#if roomMuted}<BellOff {...iconMd} aria-hidden="true" />{:else}<Bell {...iconMd} aria-hidden="true" />{/if}
      {/snippet}
    </PopoverMenuItem>
  {/if}

  <PopoverDivider />
  {#if isOwner && onOpenSettings}
    <PopoverMenuItem label="Настройки комнаты" onclick={openSettings}>
      {#snippet icon()}<Settings {...iconMd} aria-hidden="true" />{/snippet}
    </PopoverMenuItem>
  {:else if !isOwner}
    <PopoverMenuItem label="Удалить из списка" variant="danger" disabled={removeSaving} onclick={() => void removeBookmark()}>
      {#snippet icon()}<Trash2 {...iconMd} aria-hidden="true" />{/snippet}
    </PopoverMenuItem>
  {/if}
</div>

<style>
  .room-menu-content {
    display: flex;
    width: min(286px, calc(100vw - 28px));
    max-width: 100%;
    flex-direction: column;
    gap: 2px;
  }

  .room-menu-head { display: flex; align-items: center; gap: 12px; padding: 10px 10px 12px; }
  .room-menu-info { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }

  :global(.room-menu-name) {
    color: var(--warm-ink, #ece7d9);
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  :global(.room-menu-code) {
    color: var(--warm-muted, #9a9484);
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.02em;
  }
</style>
