<script lang="ts">
  import { Bell, BellOff, ChevronDown, ChevronLeft, Copy, Link } from '@lucide/svelte';
  import type { OwnedRoom } from '$lib/api/auth';
  import { Avatar, Ellipsis, Popover, PopoverDivider, PopoverMenuItem } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { roomDisplayName } from '../../model/rooms';
  import { copyText } from '../../services/desktop-download';
  import { isRoomNotificationsMuted, updateRoomNotificationsMuted } from '../../model/notification-preferences.svelte';

  let { room, onBack, onToast } = $props<{
    room: OwnedRoom;
    onBack: () => void;
    onToast?: (message: string) => void;
  }>();

  const name = $derived(roomDisplayName(room));
  const roomMuted = $derived(isRoomNotificationsMuted(room.roomId));
  let muteSaving = $state(false);

  async function toggleRoomMute(close: () => void): Promise<void> {
    if (muteSaving) return;
    muteSaving = true;
    try {
      await updateRoomNotificationsMuted(room.roomId, !roomMuted);
      onToast?.(roomMuted ? 'Уведомления комнаты включены' : 'Уведомления комнаты выключены');
      close();
    } catch {
      onToast?.('Не удалось изменить уведомления');
    } finally {
      muteSaving = false;
    }
  }

  async function copyValue(value: string, message: string, close: () => void): Promise<void> {
    try {
      await copyText(value);
      onToast?.(message);
    } catch {
      onToast?.('Не удалось скопировать');
    }
    close();
  }
</script>

<div class="lobby-roomview-head">
  <button class="lobby-roomview-back" type="button" title="К списку комнат" aria-label="Назад" onclick={onBack}>
    <ChevronLeft {...iconMd} aria-hidden="true" />
  </button>

  <Popover
    placement="bottom-start"
    role="menu"
    ariaLabel="Меню комнаты"
    panelClass="lobby-roomview-popover"
  >
    {#snippet trigger({ open, toggle, panelId })}
      <button
        class="lobby-roomview-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onclick={toggle}
      >
        <Avatar name={name} src={room.avatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={34} />
        <span class="lobby-roomview-name">
          <Ellipsis text={name} title={room.roomId} />
        </span>
        <span class="lobby-roomview-chevron" aria-hidden="true">
          <ChevronDown {...iconSm} aria-hidden="true" />
        </span>
      </button>
    {/snippet}

    {#snippet content({ close })}
      <div class="lobby-roomview-popover-head">
        <Avatar name={name} src={room.avatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={34} />
        <div class="lobby-roomview-popover-info">
          <Ellipsis class="lobby-roomview-popover-name" text={name} />
          <Ellipsis class="lobby-roomview-popover-code" text={room.roomId} />
        </div>
      </div>

      <PopoverDivider />

      <PopoverMenuItem label="Скопировать код" onclick={() => void copyValue(room.roomId, 'Код скопирован', close)}>
        {#snippet icon()}
          <Copy {...iconMd} aria-hidden="true" />
        {/snippet}
      </PopoverMenuItem>

      <PopoverMenuItem label={roomMuted ? 'Включить уведомления' : 'Выключить уведомления'} onclick={() => void toggleRoomMute(close)} disabled={muteSaving}>
        {#snippet icon()}
          {#if roomMuted}<BellOff {...iconMd} aria-hidden="true" />{:else}<Bell {...iconMd} aria-hidden="true" />{/if}
        {/snippet}
      </PopoverMenuItem>

      <PopoverMenuItem label="Скопировать ссылку" onclick={() => void copyValue(`${window.location.origin}/r/${encodeURIComponent(room.roomId)}`, 'Ссылка скопирована', close)}>
        {#snippet icon()}
          <Link {...iconMd} aria-hidden="true" />
        {/snippet}
      </PopoverMenuItem>
    {/snippet}
  </Popover>
</div>
