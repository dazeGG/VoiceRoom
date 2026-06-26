<script lang="ts">
  import { tick } from 'svelte';
  import type { Snippet } from 'svelte';
  import '$lib/shared/styles/popover.css';
  import {
    effectivePanelHeight,
    resolvePopoverPlacement,
    type PopoverPlacement
  } from './popover-placement';

  export type { PopoverPlacement } from './popover-placement';
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
    keepContentMounted = false,
    flip = false,
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
    /** Keep panel in the DOM when closed (for ids the vanilla client updates). */
    keepContentMounted?: boolean;
    /** Flip vertically on open when the preferred side would leave the viewport. */
    flip?: boolean;
    onBeforeClose?: (reason: PopoverCloseReason) => boolean | void;
    trigger: Snippet<[PopoverTriggerState]>;
    content: Snippet<[PopoverContentState]>;
  } = $props();

  const panelId = `popover-panel-${++panelCounter}`;
  let root = $state<HTMLElement | null>(null);
  let resolvedPlacement = $state<PopoverPlacement>(placement);

  $effect(() => {
    if (!open) {
      resolvedPlacement = placement;
      return;
    }

    if (!flip || !root) {
      resolvedPlacement = placement;
      return;
    }

    let cancelled = false;
    resolvedPlacement = placement;

    void (async () => {
      await tick();
      if (cancelled || !root) return;

      const panel = root.querySelector<HTMLElement>('.popover-panel');
      const triggerEl = root.firstElementChild;
      if (!(panel instanceof HTMLElement) || !(triggerEl instanceof HTMLElement)) return;

      resolvedPlacement = resolvePopoverPlacement(
        triggerEl.getBoundingClientRect(),
        effectivePanelHeight(panel),
        placement
      );
    })();

    return () => {
      cancelled = true;
    };
  });

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

  {#if open || keepContentMounted}
    <div
      id={panelId}
      class={`popover-panel ${panelClass}`.trim()}
      class:popover-panel--closed={keepContentMounted && !open}
      data-placement={resolvedPlacement}
      {role}
      aria-label={ariaLabel || undefined}
      aria-hidden={keepContentMounted && !open ? true : undefined}
      hidden={keepContentMounted && !open ? true : undefined}
    >
      {@render content(contentState)}
    </div>
  {/if}
</div>