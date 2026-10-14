<script lang="ts">
  import type { AppUpdate } from './app-update.svelte';

  let { update, inCall }: { update: AppUpdate; inCall: boolean } = $props();

  const title = $derived(update.pending === 'app' ? 'Новая версия приложения' : 'Доступно обновление');
  const action = $derived(update.pending === 'app' ? 'Перезапустить' : 'Обновить');
</script>

{#if update.pending !== 'none'}
  <div class="app-update" role="status" aria-live="polite">
    <span class="app-update-dot" aria-hidden="true"></span>
    <span class="app-update-title">{title}</span>
    {#if inCall}
      <span class="app-update-note">после звонка</span>
    {:else}
      <button class="app-update-action" type="button" disabled={update.applying} onclick={() => void update.apply()}>
        {action}
      </button>
    {/if}
  </div>
{/if}

<style>
  .app-update {
    /* Top centre: the lobby sidebar keeps its profile controls bottom-left and
       the room chat its composer bottom-right. */
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 900;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 12px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 999px;
    background: var(--vr-surface);
    box-shadow: var(--vr-shadow-toast);
    color: var(--vr-text);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
  }

  .app-update-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vr-accent);
  }

  .app-update-note {
    padding-right: 8px;
    color: var(--vr-offline);
    font-weight: 500;
  }

  .app-update-action {
    height: 28px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
    font: inherit;
    cursor: pointer;
  }

  .app-update-action:hover {
    background: var(--vr-accent-hover);
  }

  .app-update-action:disabled {
    cursor: progress;
    opacity: 0.7;
  }
</style>
