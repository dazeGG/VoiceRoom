<script lang="ts" module>
  let popoverPanelCounter = 0;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import {
    parsePlacement,
    resolvePopoverPlacement,
    viewportSpaceAroundTrigger
  } from './popover-placement';
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
  let panel = $state<HTMLElement | null>(null);
  let resolvedPlacement = $state<PopoverPlacement>('bottom-end');
  let availableHeight = $state<number | null>(null);
  let measureGeneration = 0;

  $effect(() => {
    if (!open) {
      resolvedPlacement = placement;
      availableHeight = null;
    }
  });

  $effect(() => {
    if (!open || role !== 'menu') return;
    void focusMenuAfterOpen();
  });

  async function focusMenuAfterOpen(): Promise<void> {
    await tick();
    if (!open || role !== 'menu') return;
    focusMenuItem(0);
  }

  async function resolvePlacementAfterOpen(generation: number): Promise<void> {
    await tick();
    await nextFrame();
    if (generation !== measureGeneration || !open || !root) return;

    const panel = root.querySelector<HTMLElement>('.popover-panel');
    const triggerEl = root.firstElementChild;
    if (!(panel instanceof HTMLElement) || !(triggerEl instanceof HTMLElement)) return;

    // The panel is positioned against the root box, which may be taller than
    // its trigger when a toolbar stretches its children. Measure that same
    // anchor so the available-space calculation matches the CSS geometry.
    const anchorRect = root.getBoundingClientRect();
    const nextPlacement = resolvePopoverPlacement(
      anchorRect,
      panel.getBoundingClientRect(),
      placement
    );
    resolvedPlacement = nextPlacement;
    const { spaceAbove, spaceBelow } = viewportSpaceAroundTrigger(anchorRect);
    const panelStyle = getComputedStyle(panel);
    const panelChromeHeight =
      Number.parseFloat(panelStyle.paddingTop) +
      Number.parseFloat(panelStyle.paddingBottom) +
      Number.parseFloat(panelStyle.borderTopWidth) +
      Number.parseFloat(panelStyle.borderBottomWidth);
    availableHeight = Math.max(
      0,
      (parsePlacement(nextPlacement).vertical === 'top' ? spaceAbove : spaceBelow) - panelChromeHeight
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

  function menuItems(): HTMLElement[] {
    if (!panel || role !== 'menu') return [];
    return Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter((item) => {
      if (item.hasAttribute('disabled')) return false;
      if (item.getAttribute('aria-disabled') === 'true') return false;
      return item.tabIndex >= 0;
    });
  }

  function focusMenuItem(index: number): void {
    const items = menuItems();
    if (items.length === 0) {
      panel?.focus();
      return;
    }
    items[(index + items.length) % items.length]?.focus();
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (role !== 'menu') return;
    const items = menuItems();
    if (items.length === 0) return;
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusMenuItem(currentIndex < 0 ? 0 : currentIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusMenuItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusMenuItem(items.length - 1);
    }
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
      bind:this={panel}
      class={`popover-panel ${panelClass}`.trim()}
      class:popover-panel--closed={keepContentMounted && !open}
      data-placement={resolvedPlacement}
      {role}
      aria-label={ariaLabel || undefined}
      aria-hidden={keepContentMounted && !open ? true : undefined}
      hidden={keepContentMounted && !open ? true : undefined}
      style:--popover-available-height={availableHeight === null ? undefined : `${availableHeight}px`}
      onkeydown={onPanelKeydown}
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

  /* Matches the context-menu panel so a popover menu and a right-click menu are
     visually the same surface. */
  .popover-panel {
    position: absolute;
    z-index: 50;
    min-width: 0;
    padding: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    background: color-mix(in srgb, var(--warm-800) 94%, transparent);
    backdrop-filter: blur(20px);
    box-shadow: 0 26px 70px rgba(0, 0, 0, 0.62);
  }

  @media (prefers-reduced-motion: no-preference) {
    .popover-panel:not(.popover-panel--closed) {
      animation: popover-panel-enter 120ms ease-out;
    }
  }

  @keyframes popover-panel-enter {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
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
