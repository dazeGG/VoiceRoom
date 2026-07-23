<script lang="ts">
  import type { AttachmentComposeStore, ComposeDraft } from './attachment-compose.svelte';
  import './attachment.css';

  let { store, disabled = false }: { store: AttachmentComposeStore; disabled?: boolean } = $props();

  function stateLabel(draft: ComposeDraft): string {
    if (draft.error) return draft.error;
    if (draft.state === 'ready') return 'Готово';
    if (draft.state === 'failed') return 'Не удалось обработать';
    return draft.state === 'processing' ? 'Обработка…' : 'Загрузка…';
  }
</script>

{#if store.drafts.length}
  <section class="attachment-composer" aria-label="Изображения к сообщению">
    <ol class="attachment-draft-list">
      {#each store.drafts as draft, index (draft.id)}
        <li>
          <span>{draft.file?.name || `Изображение ${index + 1}`}</span>
          <span aria-live="polite">{stateLabel(draft)}{draft.state === 'pending' ? ` ${Math.round(draft.progress * 100)}%` : ''}</span>
          <span class="attachment-actions">
            <button type="button" aria-label="Переместить раньше" disabled={disabled || index === 0} onclick={() => store.move(index, index - 1)}>↑</button>
            <button type="button" aria-label="Переместить позже" disabled={disabled || index === store.drafts.length - 1} onclick={() => store.move(index, index + 1)}>↓</button>
            {#if draft.state === 'failed'}<button type="button" disabled={disabled} onclick={() => void store.retry(draft)}>Повторить</button>{/if}
            <button type="button" disabled={disabled} onclick={() => void store.remove(draft)}>Удалить</button>
          </span>
        </li>
      {/each}
    </ol>
  </section>
{/if}
