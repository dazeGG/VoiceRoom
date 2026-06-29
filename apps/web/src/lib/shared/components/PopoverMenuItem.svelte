<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    onclick,
    disabled = false,
    variant = 'default',
    showChevron = false,
    icon,
    role = 'menuitem'
  }: {
    label: string;
    onclick?: (event: MouseEvent) => void;
    disabled?: boolean;
    variant?: 'default' | 'danger';
    showChevron?: boolean;
    icon?: Snippet;
    role?: 'menuitem' | 'option';
  } = $props();
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