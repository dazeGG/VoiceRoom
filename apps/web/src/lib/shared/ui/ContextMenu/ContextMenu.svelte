<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ContextMenuProps } from './types';

  const EDGE_GAP = 8;

  let {
    open,
    x,
    y,
    ariaLabel,
    restoreFocus = null,
    onClose,
    content
  }: ContextMenuProps = $props();

  let panel = $state<HTMLDivElement | null>(null);
  let left = $state(EDGE_GAP);
  let top = $state(EDGE_GAP);
  let positionGeneration = 0;

  function close(shouldRestoreFocus = true): void {
    onClose();
    if (shouldRestoreFocus && restoreFocus) {
      queueMicrotask(() => restoreFocus?.focus());
    }
  }

  function menuItems(): HTMLElement[] {
    if (!panel) return [];
    return [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
  }

  function focusItem(index: number): void {
    const items = menuItems();
    if (items.length === 0) {
      panel?.focus();
      return;
    }
    items[(index + items.length) % items.length]?.focus();
  }

  async function positionAndFocus(generation: number): Promise<void> {
    await tick();
    if (!open || generation !== positionGeneration || !panel) return;

    const rect = panel.getBoundingClientRect();
    left = Math.min(Math.max(EDGE_GAP, x), Math.max(EDGE_GAP, window.innerWidth - rect.width - EDGE_GAP));
    top = Math.min(Math.max(EDGE_GAP, y), Math.max(EDGE_GAP, window.innerHeight - rect.height - EDGE_GAP));
    await tick();
    if (open && generation === positionGeneration) focusItem(0);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!open) return;
    const items = menuItems();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(currentIndex < 0 ? 0 : currentIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(items.length - 1);
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!open || !panel || panel.contains(event.target as Node)) return;
    close(false);
  }

  function handleFocusOut(event: FocusEvent): void {
    if (!open || !panel || !(event.relatedTarget instanceof Node)) return;
    if (!panel.contains(event.relatedTarget)) close(false);
  }

  function handleViewportChange(): void {
    if (open) close();
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, { capture: true });
    };
  });

  $effect(() => {
    if (!open) return;
    void x;
    void y;
    const generation = ++positionGeneration;
    void positionAndFocus(generation);
  });
</script>

{#if open}
  <div
    bind:this={panel}
    class="context-menu-panel"
    data-context-menu
    role="menu"
    aria-label={ariaLabel}
    tabindex="-1"
    style:left={`${left}px`}
    style:top={`${top}px`}
    onfocusout={handleFocusOut}
  >
    {@render content({ close })}
  </div>
{/if}

<style>
  .context-menu-panel {
    position: fixed;
    z-index: 140;
    box-sizing: border-box;
    min-width: min(244px, calc(100vw - 16px));
    max-width: min(320px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
    padding: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 18px;
    background: #16140f;
    box-shadow:
      0 24px 60px rgba(0, 0, 0, 0.55),
      0 2px 0 rgba(255, 255, 255, 0.04) inset;
  }

  .context-menu-panel:focus {
    outline: none;
  }

  .context-menu-panel :global([role='menuitem']:focus-visible) {
    outline: 2px solid color-mix(in oklch, var(--accent), white 12%);
    outline-offset: 1px;
  }

  @media (prefers-reduced-motion: no-preference) {
    .context-menu-panel {
      animation: context-menu-enter 120ms cubic-bezier(0.22, 1, 0.36, 1);
      transform-origin: top left;
    }
  }

  @keyframes context-menu-enter {
    from { opacity: 0; transform: translateY(-3px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
</style>
