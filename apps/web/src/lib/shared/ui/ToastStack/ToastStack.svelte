<script lang="ts">
  import { Bell, Check, CircleAlert, Info, TriangleAlert, X } from '@lucide/svelte';
  import { iconXs } from '$lib/shared/ui/icons';
  import type { ToastStackProps } from './types';

  let { toasts, onDismiss }: ToastStackProps = $props();
  const visibleToasts = $derived(toasts.slice(-3));
  const queuedCount = $derived(Math.max(0, toasts.length - visibleToasts.length));
</script>

{#if toasts.length > 0}
  <div class="ui-toaststack" role="status" aria-live="polite">
    {#if queuedCount > 0}<span class="ui-toast-queue">+{queuedCount} в очереди</span>{/if}
    {#each visibleToasts as toast (toast.id)}
      <div class="ui-toast" data-variant={toast.variant ?? 'default'} style:--toast-duration={`${toast.duration ?? 3200}ms`}>
        <span class="ui-toast-icon" aria-hidden="true">
          {#if toast.variant === 'success'}<Check {...iconXs} />
          {:else if toast.variant === 'error'}<CircleAlert {...iconXs} />
          {:else if toast.variant === 'warning'}<TriangleAlert {...iconXs} />
          {:else if toast.variant === 'info'}<Info {...iconXs} />
          {:else}<Bell {...iconXs} />{/if}
        </span>
        <span class="ui-toast-copy"><strong class="ui-toast-message">{toast.message}</strong>{#if toast.description}<span class="ui-toast-description">{toast.description}</span>{/if}</span>
        {#if toast.actions?.length}
          <div class="ui-toast-actions">
            {#each toast.actions as action}
              <button class="ui-toast-action" type="button" onclick={() => action.onClick(toast.id)}>{action.label}</button>
            {/each}
          </div>
        {/if}
        <button class="ui-toast-close" type="button" aria-label="Закрыть уведомление" onclick={() => onDismiss(toast.id)}>
          <X {...iconXs} aria-hidden="true" />
        </button>
        {#if (toast.duration ?? 3200) > 0}<span class="ui-toast-progress" aria-hidden="true"></span>{/if}
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
    align-items: flex-end;
    gap: 8px;
    max-width: min(360px, calc(100vw - 32px));
  }

  .ui-toast {
    --toast-accent: var(--warm-muted);
    position: relative;
    display: flex;
    width: min(382px, calc(100vw - 32px));
    align-items: flex-start;
    gap: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 13px 42px 15px 14px;
    overflow: hidden;
    background: color-mix(in oklch, var(--paper-deep), black 7%);
    box-shadow: 0 16px 44px oklch(4% 0.01 92 / 0.38);
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-weight: 700;
    font-size: 13.5px;
    line-height: 1.35;
    overflow-wrap: anywhere;
    animation: ui-toast-in 180ms var(--ease-out);
  }

  .ui-toast[data-variant='error'] {
    --toast-accent: var(--coral);
  }
  .ui-toast[data-variant='success'] { --toast-accent: var(--green); }
  .ui-toast[data-variant='warning'] { --toast-accent: oklch(78% 0.15 83); }
  .ui-toast[data-variant='info'] { --toast-accent: var(--blue); }
  .ui-toast-icon { display: grid; width: 30px; height: 30px; flex: none; place-items: center; border-radius: 50%; background: color-mix(in oklch, var(--toast-accent), transparent 82%); color: var(--toast-accent); }
  .ui-toast-copy { display: grid; flex: 1; min-width: 0; gap: 3px; }

  .ui-toast-message {
    white-space: pre-line;
  }
  .ui-toast-description { color: var(--warm-muted); font-size: 12.5px; font-weight: 550; }
  .ui-toast-queue { border: 1px solid rgba(255,255,255,.1); border-radius: 999px; padding: 5px 10px; background: var(--paper-deep); color: var(--warm-muted); font: 500 11px var(--font-mono); }

  .ui-toast-actions {
    display: flex;
    flex: none;
    gap: 6px;
  }

  .ui-toast-action {
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 7px;
    padding: 4px 7px;
    background: rgba(255, 255, 255, 0.07);
    color: var(--warm-ink);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .ui-toast-action:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .ui-toast-close {
    position: absolute;
    top: 12px;
    right: 12px;
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
  .ui-toast-progress { position: absolute; right: 14px; bottom: 0; left: 14px; height: 3px; border-radius: 999px 999px 0 0; background: var(--toast-accent); transform-origin: left; animation: ui-toast-progress var(--toast-duration) linear forwards; }

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
  @keyframes ui-toast-progress { to { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) { .ui-toast, .ui-toast-progress { animation: none; } }
</style>
