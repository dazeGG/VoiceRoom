<script lang="ts">
  import { BellOff, ChevronDown } from '@lucide/svelte';
  import type { RoomRelationship } from '$lib/api/auth';
  import type { Friend } from '$lib/api/friends';
  import { Avatar, Ellipsis, Popover } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import { isRoomNotificationsMuted } from '$lib/shared/notifications/preferences.svelte';
  import type { PopoverPlacement } from '$lib/shared/ui';
  import RoomMenuContent from './RoomMenuContent.svelte';

  let {
    roomId,
    name,
    avatarUrl = null,
    avatarSize = 38,
    triggerClass = '',
    titleClass = '',
    chevronClass = '',
    heading = false,
    headingClass = '',
    placement = 'bottom-start',
    keepContentMounted = false,
    relationship = 'owner',
    friends,
    presentUserIds = new Set<string>(),
    onOpenSettings,
    inviteContent,
    onRoomsChanged,
    onToast,
    showNotificationControls = true
  } = $props<{
    roomId: string;
    name: string;
    avatarUrl?: string | null;
    avatarSize?: number;
    triggerClass?: string;
    titleClass?: string;
    chevronClass?: string;
    heading?: boolean;
    headingClass?: string;
    placement?: PopoverPlacement;
    keepContentMounted?: boolean;
    relationship?: RoomRelationship;
    friends?: Friend[];
    presentUserIds?: Set<string>;
    onOpenSettings?: () => void;
    inviteContent?: import('svelte').Snippet<[close: () => void]>;
    onRoomsChanged?: () => void;
    onToast?: (message: string) => void;
    showNotificationControls?: boolean;
  }>();

  const roomMuted = $derived(showNotificationControls && isRoomNotificationsMuted(roomId));
</script>

{#snippet menuButton(open: boolean, toggle: () => void, panelId: string)}
  <button
    class={`room-menu-trigger ${triggerClass}`.trim()}
    type="button"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={panelId}
    onclick={toggle}
  >
    <Avatar {name} src={avatarUrl} shape="squircle" background="var(--room-avatar-bg)" size={avatarSize} />
    <Ellipsis text={name} title={roomId} class={`room-menu-title ${titleClass}`.trim()} />
    {#if roomMuted}
      <span class="room-menu-notifications-muted" role="img" aria-label="Уведомления отключены" title="Уведомления отключены">
        <BellOff {...iconSm} aria-hidden="true" />
      </span>
    {/if}
    <span class={`room-menu-chevron ${chevronClass}`.trim()} aria-hidden="true">
      <ChevronDown {...iconSm} aria-hidden="true" />
    </span>
  </button>
{/snippet}

<Popover {placement} role="menu" ariaLabel="Меню комнаты" panelClass="room-menu-popover" {keepContentMounted}>
  {#snippet trigger({ open, toggle, panelId })}
    {#if heading}
      <div class={headingClass} role="heading" aria-level="1">{@render menuButton(open, toggle, panelId)}</div>
    {:else}
      {@render menuButton(open, toggle, panelId)}
    {/if}
  {/snippet}

  {#snippet content({ close })}
    <RoomMenuContent
      {roomId}
      {name}
      {avatarUrl}
      {relationship}
      {friends}
      {presentUserIds}
      {close}
      canClose={(targetRoomId) => targetRoomId === roomId}
      {onOpenSettings}
      {inviteContent}
      {onRoomsChanged}
      {onToast}
      {showNotificationControls}
    />
  {/snippet}
</Popover>

<style>
  .room-menu-trigger {
    color: inherit;
    font: inherit;
  }

  .room-menu-title {
    min-width: 0;
  }

  .room-menu-chevron {
    flex: none;
    display: inline-flex;
    transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .room-menu-notifications-muted {
    flex: none;
    display: inline-flex;
    color: var(--warm-ink-dim);
  }

  .room-menu-trigger[aria-expanded='true'] .room-menu-chevron {
    transform: rotate(180deg);
  }
</style>
