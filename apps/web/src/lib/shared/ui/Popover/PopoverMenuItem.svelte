<script lang="ts">
  import { Check, ChevronRight } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { PopoverMenuItemProps } from './types';

  let {
    label,
    onclick,
    disabled = false,
    variant = 'default',
    selected = false,
    showChevron = false,
    chevronActive = false,
    hint,
    icon,
    role = 'menuitem',
    ariaHaspopup,
    ariaExpanded,
    ariaControls,
    onpointerenter,
    onfocus
  }: PopoverMenuItemProps = $props();
</script>

<button
  class="popover-menu-item popover-menu-item--{variant}"
  class:is-selected={selected}
  type="button"
  {role}
  {disabled}
  {onclick}
  {onpointerenter}
  {onfocus}
  aria-checked={role === 'option' ? selected : undefined}
  aria-haspopup={ariaHaspopup}
  aria-expanded={ariaExpanded}
  aria-controls={ariaControls}
>
  {#if icon}
    <span class="popover-menu-item-icon" aria-hidden="true">
      {@render icon()}
    </span>
  {/if}
  <span class="popover-menu-item-label">{label}</span>
  {#if hint}
    <span class="popover-menu-item-hint" aria-hidden="true">{hint}</span>
  {/if}
  {#if selected}
    <span class="popover-menu-item-check" aria-hidden="true">
      <Check {...iconSm} />
    </span>
  {/if}
  {#if showChevron}
    <span class="popover-menu-item-chevron" class:is-active={chevronActive} aria-hidden="true">
      <ChevronRight {...iconSm} />
    </span>
  {/if}
</button>

<style>
  .popover-menu-item {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    height: 40px;
    padding: 0 12px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--warm-ink-dim);
    font-family: var(--font-ui);
    font-size: 14.5px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;
  }

  /* Hover and keyboard focus land on the same treatment so arrow-key users see
     exactly what a pointer user sees. */
  .popover-menu-item:hover:not(:disabled),
  .popover-menu-item:focus-visible:not(:disabled),
  .popover-menu-item.is-selected {
    background: color-mix(in oklch, var(--accent), transparent 88%);
    color: var(--warm-ink);
  }

  .popover-menu-item:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .popover-menu-item-icon {
    flex: none;
    display: inline-flex;
    color: currentColor;
  }

  .popover-menu-item-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .popover-menu-item-hint {
    flex: none;
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 500;
  }

  .popover-menu-item-check,
  .popover-menu-item-chevron {
    flex: none;
    display: inline-flex;
    color: var(--warm-faint);
  }

  .popover-menu-item-check,
  .popover-menu-item-chevron.is-active {
    color: var(--accent);
  }

  .popover-menu-item--accent {
    color: var(--warm-ink);
  }

  .popover-menu-item--friendly {
    color: var(--green);
  }

  .popover-menu-item--friendly:hover:not(:disabled),
  .popover-menu-item--friendly:focus-visible:not(:disabled),
  .popover-menu-item--friendly.is-selected {
    background: color-mix(in oklch, var(--green), transparent 86%);
    color: var(--green);
  }

  .popover-menu-item--danger {
    color: var(--coral);
  }

  .popover-menu-item--danger:hover:not(:disabled),
  .popover-menu-item--danger:focus-visible:not(:disabled),
  .popover-menu-item--danger.is-selected {
    background: color-mix(in oklch, var(--coral), transparent 86%);
    color: var(--coral);
  }
</style>
