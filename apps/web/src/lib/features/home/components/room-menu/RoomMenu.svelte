<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import { Avatar, Ellipsis, Popover } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
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
    onToast,
    onOpenSettings
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
    onToast?: (message: string) => void;
    onOpenSettings?: () => void;
  }>();
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
    <span class={`room-menu-chevron ${chevronClass}`.trim()} aria-hidden="true">
      <ChevronDown {...iconSm} aria-hidden="true" />
    </span>
  </button>
{/snippet}

<Popover {placement} role="menu" ariaLabel="Меню комнаты" panelClass="room-menu-popover" {keepContentMounted}>
  {#snippet trigger({ open, toggle, panelId })}
    {#if heading}
      <h1 class={headingClass}>{@render menuButton(open, toggle, panelId)}</h1>
    {:else}
      {@render menuButton(open, toggle, panelId)}
    {/if}
  {/snippet}

  {#snippet content({ close })}
    <RoomMenuContent {roomId} {name} {avatarUrl} {close} {onToast} {onOpenSettings} />
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

  .room-menu-trigger[aria-expanded='true'] .room-menu-chevron {
    transform: rotate(180deg);
  }
</style>
