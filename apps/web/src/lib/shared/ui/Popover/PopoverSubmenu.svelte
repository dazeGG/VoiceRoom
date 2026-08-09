<script lang="ts" module>
  let submenuCounter = 0;
</script>

<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import PopoverMenuItem from './PopoverMenuItem.svelte';
  import type { PopoverSubmenuProps } from './types';

  // Long enough that a pointer crossing the row on its way elsewhere does not
  // flash the panel, short enough to feel immediate when you actually stop.
  const HOVER_DELAY_MS = 120;

  let { label, ariaLabel, disabled = false, icon, content }: PopoverSubmenuProps = $props();

  let open = $state(false);
  let row = $state<HTMLDivElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);
  let side = $state<'left' | 'right'>('right');
  let panelTop = $state(-8);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const panelId = `popover-submenu-${++submenuCounter}`;

  function triggerButton(): HTMLButtonElement | null {
    return row?.querySelector(':scope > button') ?? null;
  }

  async function placeAndFocus(focus = false): Promise<void> {
    await tick();
    if (!open || !row || !panel) return;
    const rowRect = row.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const rightSpace = window.innerWidth - rowRect.right;
    const leftSpace = rowRect.left;
    side = rightSpace >= panelRect.width + 18 || rightSpace >= leftSpace ? 'right' : 'left';
    const desiredTop = rowRect.top - 8;
    const viewportTop = Math.min(
      Math.max(8, desiredTop),
      Math.max(8, window.innerHeight - panelRect.height - 8)
    );
    panelTop = viewportTop - rowRect.top;
    await tick();
    if (focus && open) panel?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }

  function cancelTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function scheduleOpen(): void {
    if (disabled || open) return;
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      open = true;
      void placeAndFocus();
    }, HOVER_DELAY_MS);
  }

  function close(): void {
    cancelTimer();
    open = false;
  }

  function toggle(): void {
    cancelTimer();
    open = !open;
    if (open) void placeAndFocus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' && !open) {
      event.preventDefault();
      event.stopPropagation();
      open = true;
      void placeAndFocus(true);
    } else if (event.key === 'ArrowLeft' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      triggerButton()?.focus();
    }
  }

  function handlePanelKeydown(event: KeyboardEvent): void {
    const items = Array.from(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      close();
      triggerButton()?.focus();
      return;
    }
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  }

  // Leaving the row for anywhere outside the row+panel pair closes it. The CSS
  // bridge below keeps the diagonal travel to the panel inside that pair.
  function handlePointerLeave(event: PointerEvent): void {
    cancelTimer();
    const next = event.relatedTarget;
    if (next instanceof Node && row?.contains(next)) return;
    open = false;
  }

  onDestroy(cancelTimer);
</script>

<!-- The group is a hover region, not a control: pointer handlers implement the
     open-on-dwell bridge, and the keydown handler only catches ArrowLeft/Right
     bubbling up from the real button inside it. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={row}
  class="popover-submenu"
  role="group"
  onpointerenter={scheduleOpen}
  onpointerleave={handlePointerLeave}
  onkeydown={handleKeydown}
>
  <PopoverMenuItem
    {label}
    {icon}
    {disabled}
    variant={open ? 'accent' : 'default'}
    showChevron
    chevronActive={open}
    ariaHaspopup="menu"
    ariaExpanded={open}
    ariaControls={panelId}
    onclick={toggle}
  />
  {#if open}
    <div
      bind:this={panel}
      id={panelId}
      class="popover-submenu-panel"
      data-side={side}
      role="menu"
      tabindex="-1"
      aria-label={ariaLabel || label}
      style:top={`${panelTop}px`}
      onkeydown={handlePanelKeydown}
    >
      {@render content({ close })}
    </div>
  {/if}
</div>

<style>
  .popover-submenu {
    position: relative;
  }

  /* Invisible bridge across the gap so the pointer can travel from the row to
     the panel without a pointerleave closing it mid-move. */
  .popover-submenu::after {
    content: '';
    position: absolute;
    top: 0;
    left: 100%;
    width: 12px;
    height: 100%;
  }

  .popover-submenu:has(.popover-submenu-panel[data-side='left'])::after {
    right: 100%;
    left: auto;
  }

  .popover-submenu-panel {
    position: absolute;
    left: calc(100% + 10px);
    z-index: 4;
    min-width: 244px;
    max-width: min(268px, calc(100vw - 28px));
    padding: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 18px;
    background: var(--warm-800);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  }

  .popover-submenu-panel[data-side='left'] {
    right: calc(100% + 10px);
    left: auto;
  }

  @media (prefers-reduced-motion: no-preference) {
    .popover-submenu-panel {
      animation: popover-submenu-enter 120ms ease-out;
    }
  }

  @keyframes popover-submenu-enter {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
