<script lang="ts">
  import { X } from '@lucide/svelte';
  import { iconXs } from '$lib/shared/ui/icons';
  import type { ToastStackProps } from './types';

  let { toasts, onDismiss }: ToastStackProps = $props();
</script>

{#if toasts.length > 0}
  <div class="ui-toaststack" role="status" aria-live="polite">
    {#each toasts as toast (toast.id)}
      <div class="ui-toast" data-variant={toast.variant ?? 'default'}>
        <span class="ui-toast-message">{toast.message}</span>
        <button class="ui-toast-close" type="button" aria-label="Закрыть уведомление" onclick={() => onDismiss(toast.id)}>
          <X {...iconXs} aria-hidden="true" />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .ui-toaststack {
    position: fixed;
    right: var(--space-lg);
    bottom: var(--space-lg);
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(360px, calc(100vw - 32px));
  }

  .ui-toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    background: var(--paper-deep);
    box-shadow: var(--shadow);
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-weight: 700;
    font-size: 13.5px;
    line-height: 1.35;
    overflow-wrap: anywhere;
    animation: ui-toast-in 180ms var(--ease-out);
  }

  .ui-toast[data-variant='error'] {
    border-color: color-mix(in oklch, var(--coral), transparent 55%);
  }

  .ui-toast-message {
    flex: 1;
    min-width: 0;
    white-space: pre-line;
  }

  .ui-toast-close {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--warm-faint);
    cursor: pointer;
  }

  .ui-toast-close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--warm-ink);
  }

  @keyframes ui-toast-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
