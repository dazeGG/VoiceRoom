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

<button
  class="ui-button ui-button--{variant} {className}"
  {type}
  {disabled}
  {onclick}
>
  {#if icon}<span class="ui-button-icon">{@render icon()}</span>{/if}
  {#if children}{@render children()}{/if}
</button>

<style>
  .ui-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 40px;
    padding: 0 18px;
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: 13.5px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .ui-button-icon {
    display: flex;
    flex: none;
  }

  .ui-button--primary {
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: var(--shadow-glow, 0 10px 26px oklch(89% 0.24 122 / 0.28));
  }

  .ui-button--primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .ui-button--ghost {
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: var(--warm-ink);
  }

  .ui-button--ghost:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.09);
  }

  .ui-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
</style>
