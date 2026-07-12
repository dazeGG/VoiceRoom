<script lang="ts">
  import { Bell, BellOff, Copy, Link } from '@lucide/svelte';
  import { Avatar, Ellipsis, PopoverDivider, PopoverMenuItem } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import { copyText } from '$lib/shared/utils/clipboard';
  import {
    isRoomNotificationsMuted,
    updateRoomNotificationsMuted
  } from '$lib/shared/notifications/preferences.svelte';

  let {
    roomId,
    name,
    avatarUrl = null,
    close,
    canClose,
    onToast
  } = $props<{
    roomId: string;
    name: string;
    avatarUrl?: string | null;
    close: (restoreFocus?: boolean) => void;
    canClose?: (roomId: string) => boolean;
    onToast?: (message: string) => void;
  }>();

  const roomMuted = $derived(isRoomNotificationsMuted(roomId));
  let muteSaving = $state(false);

  async function copyValue(value: string, successMessage: string): Promise<void> {
    const targetRoomId = roomId;
    try {
      await copyText(value);
      if (!(canClose?.(targetRoomId) ?? true)) return;
      onToast?.(successMessage);
    } catch {
      if (!(canClose?.(targetRoomId) ?? true)) return;
      onToast?.('Не удалось скопировать');
    }
    close();
  }

  async function toggleRoomMute(): Promise<void> {
    if (muteSaving) return;
    muteSaving = true;
    const targetRoomId = roomId;
    const nextMuted = !roomMuted;
    try {
      await updateRoomNotificationsMuted(targetRoomId, nextMuted);
      if (!(canClose?.(targetRoomId) ?? true)) return;
      onToast?.(nextMuted ? 'Уведомления комнаты выключены' : 'Уведомления комнаты включены');
      close();
    } catch {
      if (!(canClose?.(targetRoomId) ?? true)) return;
      onToast?.('Не удалось изменить уведомления');
    } finally {
      muteSaving = false;
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

  <PopoverMenuItem label="Скопировать код" onclick={() => void copyValue(roomId, 'Код скопирован')}>
    {#snippet icon()}<Copy {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>

  <PopoverMenuItem
    label="Скопировать ссылку"
    onclick={() => void copyValue(`${window.location.origin}/r/${encodeURIComponent(roomId)}`, 'Ссылка скопирована')}
  >
    {#snippet icon()}<Link {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>

  <PopoverMenuItem
    label={roomMuted ? 'Включить уведомления' : 'Выключить уведомления'}
    onclick={() => void toggleRoomMute()}
    disabled={muteSaving}
  >
    {#snippet icon()}
      {#if roomMuted}<BellOff {...iconMd} aria-hidden="true" />{:else}<Bell {...iconMd} aria-hidden="true" />{/if}
    {/snippet}
  </PopoverMenuItem>

</div>

<style>
  .room-menu-content {
    width: min(264px, calc(100vw - 28px));
    max-width: 100%;
  }

  .room-menu-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 10px 12px;
  }

  .room-menu-info {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

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
