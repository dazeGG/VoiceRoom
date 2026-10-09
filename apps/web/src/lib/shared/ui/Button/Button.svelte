<script lang="ts">
  import type { ButtonProps } from './types';

  let {
    variant = 'ghost',
    type = 'button',
    disabled = false,
    class: className = '',
    onclick,
    icon,
    children
  }: ButtonProps = $props();
</script>

<button class="ui-button ui-button--{variant} {className}" {type} {disabled} {onclick}>
  {#if icon}<span class="ui-button-icon">{@render icon()}</span>{/if}
  {#if children}{@render children()}{/if}
</button>

<style>
  .ui-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--interactive-gap, 10px);
    height: 40px;
    min-height: 40px;
    padding: 0 18px;
    border: 1px solid transparent;
    border-radius: 11px;
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition:
      background 0.15s ease,
      box-shadow 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease;
  }

  .ui-button-icon {
    display: flex;
    flex: none;
  }

  .ui-button :global(svg) {
    width: 18px;
    height: 18px;
  }

  .ui-button.compact,
  .ui-button--compact {
    height: 34px;
    min-height: 34px;
    padding-inline: 14px;
    font-size: 13.5px;
    border-radius: 10px;
  }

  .ui-button--primary {
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
  }

  .ui-button--primary:hover:not(:disabled) {
    background: var(--vr-accent-hover);
  }

  .ui-button--ghost {
    background: var(--vr-surface-3);
    color: var(--vr-text);
  }

  .ui-button--ghost:hover:not(:disabled) {
    background: var(--vr-surface-3-hover);
  }

  .ui-button--outline {
    border-color: var(--vr-line-strong);
    background: transparent;
    color: var(--vr-text);
  }

  .ui-button--outline:hover:not(:disabled) {
    background: var(--vr-hover);
  }

  .ui-button--soft {
    background: var(--vr-accent-soft);
    color: var(--vr-accent);
  }

  .ui-button--soft:hover:not(:disabled) {
    background: var(--vr-accent-soft-hover);
  }

  .ui-button--danger {
    background: var(--vr-danger);
    color: var(--vr-on-danger);
  }

  .ui-button--danger:hover:not(:disabled) {
    background: color-mix(in oklch, var(--vr-danger), var(--vr-on-danger) 12%);
  }

  .ui-button--danger-ghost {
    background: transparent;
    color: var(--vr-danger);
  }

  .ui-button--danger-ghost:hover:not(:disabled) {
    background: var(--vr-danger-hover);
  }

  .ui-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
</style>
