<script lang="ts">
  import type { PopoverMenuItemProps } from './types';

  let {
    label,
    onclick,
    disabled = false,
    variant = 'default',
    showChevron = false,
    icon,
    role = 'menuitem'
  }: PopoverMenuItemProps = $props();
</script>

<button
  class="popover-menu-item"
  class:popover-menu-item--danger={variant === 'danger'}
  type="button"
  {role}
  {disabled}
  {onclick}
>
  {#if icon}
    <span class="popover-menu-item-icon" aria-hidden="true">
      {@render icon()}
    </span>
  {/if}
  <span class="popover-menu-item-label">{label}</span>
  {#if showChevron}
    <span class="popover-menu-item-chevron" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
    </span>
  {/if}
</button>

<style>
  .popover-menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 11px 12px;
    border: none;
    border-radius: 11px;
    background: transparent;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    transition: background 0.14s ease;
  }

  .popover-menu-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .popover-menu-item:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .popover-menu-item-icon {
    flex: none;
    display: inline-flex;
    color: #b8b2a2;
  }

  .popover-menu-item-label {
    flex: 1;
    color: #e7e2d4;
    font-size: 14px;
    font-weight: 500;
  }

  .popover-menu-item-chevron {
    flex: none;
    display: inline-flex;
    color: #5a5547;
  }

  .popover-menu-item--danger:hover {
    background: rgba(214, 118, 90, 0.12);
  }

  .popover-menu-item--danger .popover-menu-item-icon {
    color: #d97a5c;
  }

  .popover-menu-item--danger .popover-menu-item-label {
    color: #e9a68f;
    font-weight: 600;
  }
</style>
