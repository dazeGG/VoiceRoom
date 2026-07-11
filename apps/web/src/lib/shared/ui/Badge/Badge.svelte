<script lang="ts">
  import type { BadgeProps } from './types';

  let { tone = 'default', class: className = '', children }: BadgeProps = $props();
</script>

<span class="ui-badge ui-badge--{tone} {className}">
  {#if children}{@render children()}{/if}
</span>

<style>
  .ui-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--radius-pill);
    font-family: var(--font-ui);
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1;
  }

  .ui-badge--default {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .ui-badge--warning {
    background: color-mix(in oklch, var(--amber), transparent 78%);
    color: var(--amber);
    border: 1px solid color-mix(in oklch, var(--amber), transparent 55%);
    font-family: var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
</style>
