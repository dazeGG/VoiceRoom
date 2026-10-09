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
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    font-family: var(--font-ui);
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1;
  }

  .ui-badge--default {
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
  }

  .ui-badge--muted {
    background: var(--vr-badge-muted-bg);
    color: var(--vr-badge-muted-ink);
  }

  .ui-badge--warning {
    background: color-mix(in oklch, var(--vr-away), transparent 78%);
    color: var(--vr-away);
    border: 1px solid color-mix(in oklch, var(--vr-away), transparent 55%);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
</style>
