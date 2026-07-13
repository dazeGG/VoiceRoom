<script lang="ts">
  import { Bell, BellOff, Copy, Link, Settings, UserRoundPlus } from '@lucide/svelte';
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
    onOpenSettings,
    inviteContent,
    onToast
  } = $props<{
    roomId: string;
    name: string;
    avatarUrl?: string | null;
    close: (restoreFocus?: boolean) => void;
    canClose?: (roomId: string) => boolean;
    onOpenSettings?: () => void;
    inviteContent?: import('svelte').Snippet<[close: () => void]>;
    onToast?: (message: string) => void;
  }>();

  const roomMuted = $derived(isRoomNotificationsMuted(roomId));
  let muteSaving = $state(false);
  let inviteOpen = $state(false);

  function openSettings(): void {
    close(false);
    onOpenSettings?.();
  }

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

  {#if inviteContent}
    <div class="room-menu-submenu" role="group" onpointerenter={() => (inviteOpen = true)} onpointerleave={() => (inviteOpen = false)}>
      <PopoverMenuItem label="Позвать друга" showChevron onclick={() => (inviteOpen = true)}>
        {#snippet icon()}<UserRoundPlus {...iconMd} aria-hidden="true" />{/snippet}
      </PopoverMenuItem>
      {#if inviteOpen}
        <div class="room-menu-invite" role="menu" aria-label="Позвать друга">{@render inviteContent(close)}</div>
      {/if}
    </div>
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

  {#if onOpenSettings}
    <PopoverDivider />
    <PopoverMenuItem label="Настройки комнаты" onclick={openSettings}>
      {#snippet icon()}<Settings {...iconMd} aria-hidden="true" />{/snippet}
    </PopoverMenuItem>
  {/if}

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

  .room-menu-submenu { position: relative; }
  .room-menu-submenu::after { content: ''; position: absolute; top: 0; left: 100%; width: 10px; height: 100%; }
  .room-menu-invite {
    position: absolute;
    top: -6px;
    left: calc(100% + 10px);
    z-index: 4;
    min-width: 244px;
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 16px;
    padding: 6px;
    background: var(--warm-800);
    box-shadow: 0 24px 60px rgba(0,0,0,.48);
  }
  .room-menu-invite::before {
    content: '';
    position: absolute;
    top: 20px;
    left: -5px;
    width: 9px;
    height: 9px;
    border-bottom: 1px solid rgba(255,255,255,.1);
    border-left: 1px solid rgba(255,255,255,.1);
    background: var(--warm-800);
    transform: rotate(45deg);
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
