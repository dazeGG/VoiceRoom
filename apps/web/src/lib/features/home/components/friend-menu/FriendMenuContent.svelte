<script lang="ts">
  import { Bell, BellOff, MessageCircle, UserMinus } from '@lucide/svelte';
  import type { Friend } from '$lib/api/friends';
  import { Avatar, Ellipsis, PopoverDivider, PopoverMenuItem } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import { effectivePresenceStatus } from '$lib/shared/presence';
  import { friendName } from '../../model/lobby-format';
  import { openDm, removeFriend } from '../../model/friends.svelte';
  import {
    isPeerNotificationsMuted,
    updatePeerNotificationsMuted
  } from '$lib/shared/notifications/preferences.svelte';

  let { friend, close, canClose, onToast } = $props<{
    friend: Friend;
    close: (restoreFocus?: boolean) => void;
    canClose?: (userId: string) => boolean;
    onToast?: (message: string) => void;
  }>();

  const name = $derived(friendName(friend.user));
  const muted = $derived(isPeerNotificationsMuted(friend.user.id));
  const presence = $derived(
    effectivePresenceStatus(friend.online, friend.user.presenceStatus, friend.user.doNotDisturb)
  );
  let muteSaving = $state(false);

  async function openConversation(): Promise<void> {
    close(false);
    try {
      await openDm(friend.user.id);
    } catch {
      onToast?.('Не удалось открыть диалог');
    }
  }

  async function toggleMute(): Promise<void> {
    if (muteSaving) return;
    muteSaving = true;
    const targetUserId = friend.user.id;
    const nextMuted = !muted;
    try {
      await updatePeerNotificationsMuted(targetUserId, nextMuted);
      if (!(canClose?.(targetUserId) ?? true)) return;
      close();
    } catch {
      if (!(canClose?.(targetUserId) ?? true)) return;
      onToast?.('Не удалось изменить уведомления');
    } finally {
      muteSaving = false;
    }
  }

  async function remove(): Promise<void> {
    const userId = friend.user.id;
    close(false);
    try {
      await removeFriend(userId);
      onToast?.(`${name} удалён из друзей`);
    } catch {
      onToast?.('Не удалось удалить друга');
    }
  }
</script>

<div class="friend-menu-content" data-friend-menu-content>
  <div class="friend-menu-head">
    <Avatar
      name={name}
      src={friend.user.avatarUrl}
      colorKey={friend.user.avatarColorKey}
      background={friend.user.avatarAccent || undefined}
      size={42}
      online={presence === 'online'}
      afk={presence === 'away'}
      dnd={presence === 'dnd'}
      showDot
      ring="#16140f"
    />
    <div class="friend-menu-info">
      <Ellipsis class="friend-menu-name" text={name} />
      <Ellipsis class="friend-menu-handle" text={`@${friend.user.login}`} />
    </div>
  </div>

  <PopoverDivider />

  <PopoverMenuItem label="Открыть сообщения" onclick={() => void openConversation()}>
    {#snippet icon()}<MessageCircle {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>

  <PopoverMenuItem
    label={muted ? 'Включить уведомления' : 'Выключить уведомления'}
    onclick={() => void toggleMute()}
    disabled={muteSaving}
  >
    {#snippet icon()}
      {#if muted}<BellOff {...iconMd} aria-hidden="true" />{:else}<Bell {...iconMd} aria-hidden="true" />{/if}
    {/snippet}
  </PopoverMenuItem>

  <PopoverDivider tight />
  <PopoverMenuItem label="Удалить из друзей" variant="danger" onclick={() => void remove()}>
    {#snippet icon()}<UserMinus {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>
</div>

<style>
  .friend-menu-content {
    width: min(252px, calc(100vw - 28px));
    max-width: 100%;
  }

  .friend-menu-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 10px 12px;
  }

  .friend-menu-info {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }

  :global(.friend-menu-name) {
    color: var(--warm-ink);
    font-size: 14px;
    font-weight: 700;
  }

  :global(.friend-menu-handle) {
    color: var(--warm-muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
