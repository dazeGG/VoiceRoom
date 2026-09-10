<script lang="ts">
  import type { ReplyTarget } from './reply-store.svelte';

  let {
    preview,
    interactive = false,
    onjump
  }: {
    preview: ReplyTarget;
    interactive?: boolean;
    onjump?: (messageId: string) => void;
  } = $props();

  const author = $derived(preview.author?.name || (preview.deleted ? '' : 'Сообщение'));
  const text = $derived(preview.deleted ? 'Сообщение недоступно' : preview.text || 'Вложение');

  function jump(): void {
    if (!interactive || preview.deleted) return;
    onjump?.(preview.messageId);
  }
</script>

{#if interactive && !preview.deleted}
  <button
    class="reply-preview reply-preview-interactive"
    type="button"
    aria-label={`Перейти к сообщению${author ? ` от ${author}` : ''}`}
    onclick={jump}
  >
    {#if author}<strong>{author}</strong>{/if}
    <span>{text}</span>
  </button>
{:else}
  <div class="reply-preview" class:reply-preview-tombstone={preview.deleted} aria-label="Ответ на сообщение">
    {#if author}<strong>{author}</strong>{/if}
    <span>{text}</span>
  </div>
{/if}

<style>
  .reply-preview {
    display: grid;
    min-width: 0;
    width: 100%;
    gap: 2px;
    border: 0;
    border-inline-start: 3px solid color-mix(in oklch, var(--green), transparent 25%);
    margin: 0;
    padding: 4px 8px;
    background: color-mix(in oklch, currentColor, transparent 94%);
    color: inherit;
    font: inherit;
    text-align: start;
  }

  .reply-preview strong,
  .reply-preview span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reply-preview strong {
    font-size: 0.75rem;
  }

  .reply-preview span {
    opacity: 0.72;
    font-size: 0.8rem;
  }

  .reply-preview-interactive {
    min-height: 44px;
    cursor: pointer;
  }

  .reply-preview-interactive:hover,
  .reply-preview-interactive:focus-visible {
    background: color-mix(in oklch, currentColor, transparent 90%);
  }

  .reply-preview-tombstone {
    opacity: 0.65;
  }
</style>
