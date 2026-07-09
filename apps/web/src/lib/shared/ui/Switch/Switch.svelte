<script lang="ts">
  import type { SwitchProps } from './types';

  let { checked, onChange, ariaLabel, disabled = false }: SwitchProps = $props();
</script>

<button
  class="ui-switch"
  class:is-on={checked}
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={ariaLabel}
  {disabled}
  onclick={() => onChange(!checked)}
>
  <span class="ui-switch-thumb"></span>
</button>

<style>
  .ui-switch {
    flex: none;
    width: 42px;
    height: 24px;
    padding: 3px;
    border: none;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.14);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .ui-switch.is-on {
    background: var(--accent);
  }

  .ui-switch:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .ui-switch-thumb {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--warm-ink);
    transition: transform 0.15s ease;
  }

  .ui-switch.is-on .ui-switch-thumb {
    transform: translateX(18px);
    background: var(--accent-ink);
  }
</style>
