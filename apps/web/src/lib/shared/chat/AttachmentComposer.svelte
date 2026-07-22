<script lang="ts">
  import type { AttachmentComposeStore, ComposeDraft } from './attachment-compose.svelte';
  import './attachment.css';

  let { store, disabled = false }: { store: AttachmentComposeStore; disabled?: boolean } = $props();
  let input: HTMLInputElement;
  let dragging = $state(false);
  let error = $state('');

  async function add(list: FileList | null) {
    if (!list || disabled) return;
    error = '';
    try { await store.addFiles(list); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Не удалось добавить изображение'; }
    finally { if (input) input.value = ''; }
  }

  function stateLabel(draft: ComposeDraft): string {
    if (draft.error) return draft.error;
    if (draft.state === 'ready') return 'Готово';
    if (draft.state === 'failed') return 'Не удалось обработать';
    return draft.state === 'processing' ? 'Обработка…' : 'Загрузка…';
  }
</script>

<section class:dragging class="attachment-composer" aria-label="Изображения к сообщению"
  ondragover={(event) => { event.preventDefault(); dragging = true; }}
  ondragleave={() => { dragging = false; }}
  ondrop={(event) => { event.preventDefault(); dragging = false; void add(event.dataTransfer?.files || null); }}
  onpaste={(event) => { const files = event.clipboardData?.files; if (files?.length) { event.preventDefault(); void add(files); } }}>
  <input bind:this={input} class="attachment-file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple
    onchange={(event) => void add(event.currentTarget.files)} disabled={disabled || store.drafts.length >= 4} />
  <button class="attachment-add" type="button" onclick={() => input.click()} disabled={disabled || store.drafts.length >= 4}>
    Добавить изображения
  </button>
  {#if error}<p class="attachment-error" role="alert">{error}</p>{/if}
  {#if store.drafts.length}
    <ol class="attachment-draft-list">
      {#each store.drafts as draft, index (draft.id)}
        <li>
          <span>{draft.file?.name || `Изображение ${index + 1}`}</span>
          <span aria-live="polite">{stateLabel(draft)}{draft.state === 'pending' ? ` ${Math.round(draft.progress * 100)}%` : ''}</span>
          <span class="attachment-actions">
            <button type="button" aria-label="Переместить раньше" disabled={index === 0} onclick={() => store.move(index, index - 1)}>↑</button>
            <button type="button" aria-label="Переместить позже" disabled={index === store.drafts.length - 1} onclick={() => store.move(index, index + 1)}>↓</button>
            {#if draft.state === 'failed'}<button type="button" onclick={() => void store.retry(draft)}>Повторить</button>{/if}
            <button type="button" onclick={() => void store.remove(draft)}>Удалить</button>
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</section>
