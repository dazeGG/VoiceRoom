<script lang="ts">
  import type { Snippet } from 'svelte';
  import '$lib/shared/styles/popover.css';

  export type PopoverPlacement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';
  export type PopoverRole = 'menu' | 'listbox' | 'dialog';
  export type PopoverCloseReason = 'outside' | 'escape';

  export type PopoverTriggerState = {
    open: boolean;
    toggle: () => void;
    close: () => void;
    panelId: string;
  };

  export type PopoverContentState = {
    open: boolean;
    close: () => void;
  };

  let panelCounter = 0;

  let {
    open = $bindable(false),
    placement = 'bottom-end',
    role = 'menu',
    ariaLabel = '',
    rootClass = '',
    panelClass = '',
    onBeforeClose,
    trigger,
    content
  }: {
    open?: boolean;
    placement?: PopoverPlacement;
    role?: PopoverRole;
    ariaLabel?: string;
    rootClass?: string;
    panelClass?: string;
    onBeforeClose?: (reason: PopoverCloseReason) => boolean | void;
    trigger: Snippet<[PopoverTriggerState]>;
    content: Snippet<[PopoverContentState]>;
  } = $props();

  const panelId = `popover-panel-${++panelCounter}`;
  let root = $state<HTMLElement | null>(null);

  function toggle(): void {
    open = !open;
  }

  function close(): void {
    open = false;
  }

  function requestClose(reason: PopoverCloseReason): void {
    if (onBeforeClose?.(reason) === false) return;
    close();
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open || !root) return;
    if (!root.contains(event.target as Node)) requestClose('outside');
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (!open || event.key !== 'Escape') return;
    requestClose('escape');
  }

  const triggerState = $derived({
    open,
    toggle,
    close,
    panelId
  } satisfies PopoverTriggerState);

  const contentState = $derived({
    open,
    close
  } satisfies PopoverContentState);
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div class={`popover-root ${rootClass}`.trim()} bind:this={root}>
  {@render trigger(triggerState)}

  {#if open}
    <div
      id={panelId}
      class={`popover-panel ${panelClass}`.trim()}
      data-placement={placement}
      {role}
      aria-label={ariaLabel || undefined}
    >
      {@render content(contentState)}
    </div>
  {/if}
</div>