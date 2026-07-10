<script lang="ts">
  import { X } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { DialogProps } from './types';

  let { open, title, onClose, width = 430, children }: DialogProps = $props();

  function onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="ui-dialog-overlay" role="presentation" onclick={onOverlayClick}>
    <div class="ui-dialog-card" style:width={`min(${width}px, 100%)`} role="dialog" aria-modal="true" aria-labelledby="uiDialogTitle">
      <div class="ui-dialog-head">
        <span class="ui-dialog-title" id="uiDialogTitle">{title}</span>
        <button class="ui-dialog-close" type="button" aria-label="Закрыть" onclick={onClose}>
          <X {...iconSm} aria-hidden="true" />
        </button>
      </div>
      <div class="ui-dialog-body">
        {#if children}{@render children()}{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .ui-dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(8, 7, 5, 0.62);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .ui-dialog-card {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-xl);
    background: var(--paper-deep);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .ui-dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 22px 16px;
  }

  .ui-dialog-title {
    color: var(--warm-ink);
    font-family: var(--font-sans);
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .ui-dialog-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.05);
    color: var(--warm-muted);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .ui-dialog-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--warm-ink);
  }

  .ui-dialog-body {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 20px 22px 22px;
  }
</style>
