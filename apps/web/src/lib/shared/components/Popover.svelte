<script lang="ts" module>
  let popoverPanelCounter = 0;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import type { Snippet } from 'svelte';
  import '$lib/shared/styles/popover.css';
  import { resolvePopoverPlacement, type PopoverPlacement } from './popover-placement';

  function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

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

  const panelId = `popover-panel-${++popoverPanelCounter}`;
  let root = $state<HTMLElement | null>(null);
  let resolvedPlacement = $state<PopoverPlacement>('bottom-end');
  let measureGeneration = 0;

  $effect(() => {
    if (!open) resolvedPlacement = placement;
  });

  async function resolvePlacementAfterOpen(generation: number): Promise<void> {
    await tick();
    await nextFrame();
    if (generation !== measureGeneration || !open || !root) return;

    const panel = root.querySelector<HTMLElement>('.popover-panel');
    const triggerEl = root.firstElementChild;
    if (!(panel instanceof HTMLElement) || !(triggerEl instanceof HTMLElement)) return;

    resolvedPlacement = resolvePopoverPlacement(
      triggerEl.getBoundingClientRect(),
      panel.getBoundingClientRect(),
      placement
    );
  }

  function openWithPlacement(): void {
    resolvedPlacement = placement;
    if (!flip) return;
    const generation = ++measureGeneration;
    void resolvePlacementAfterOpen(generation);
  }

  function toggle(): void {
    if (open) {
      open = false;
      return;
    }
    open = true;
    openWithPlacement();
  }

  function focusTrigger(): void {
    const triggerEl = root?.firstElementChild;
    if (triggerEl instanceof HTMLElement) {
      queueMicrotask(() => triggerEl.focus());
    }
  }

  function close(): void {
    open = false;
    focusTrigger();
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
