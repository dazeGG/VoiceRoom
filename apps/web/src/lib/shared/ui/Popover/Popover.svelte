<script lang="ts" module>
  let popoverPanelCounter = 0;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { resolvePopoverPlacement } from './popover-placement';
  import type {
    PopoverCloseReason,
    PopoverContentState,
    PopoverPlacement,
    PopoverProps,
    PopoverTriggerState
  } from './types';

  function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

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
  }: PopoverProps = $props();

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

  function close(restoreFocus = true): void {
    open = false;
    if (restoreFocus) focusTrigger();
  }

  function requestClose(reason: PopoverCloseReason, restoreFocus = reason === 'escape'): void {
    if (onBeforeClose?.(reason) === false) return;
    close(restoreFocus);
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open || !root) return;
    if (!root.contains(event.target as Node)) requestClose('outside', false);
  }

  function onFocusOut(event: FocusEvent): void {
    if (!open || !root) return;
    const nextTarget = event.relatedTarget;
    // A null relatedTarget is ambiguous — it also happens when focus is lost
    // to a non-focusable click inside the panel (plain label/text), not just
    // when focus truly leaves the popover. Only close on a definite focus
    // move to a real outside element; onWindowPointerDown already covers
    // genuine outside clicks.
    if (!(nextTarget instanceof Node)) return;
    if (root.contains(nextTarget)) return;
    requestClose('focusout', false);
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

<div class={`popover-root ${rootClass}`.trim()} bind:this={root} onfocusout={onFocusOut}>
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

<style>
  /* Floating panel chrome — Popover owns open/close + placement; consumers fill slots. */
  .popover-root {
    position: relative;
    flex: none;
  }

  .popover-panel {
    position: absolute;
    z-index: 50;
    min-width: 0;
    padding: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 18px;
    background: #16140f;
    box-shadow:
      0 24px 60px rgba(0, 0, 0, 0.55),
      0 2px 0 rgba(255, 255, 255, 0.04) inset;
  }

  .popover-panel--closed {
    display: none !important;
    pointer-events: none;
  }

  .popover-panel[data-placement='bottom-end'] {
    top: calc(100% + 10px);
    right: 0;
  }

  .popover-panel[data-placement='bottom-start'] {
    top: calc(100% + 10px);
    left: 0;
  }

  .popover-panel[data-placement='top-end'] {
    bottom: calc(100% + 10px);
    right: 0;
  }

  .popover-panel[data-placement='top-start'] {
    bottom: calc(100% + 10px);
    left: 0;
  }
</style>
