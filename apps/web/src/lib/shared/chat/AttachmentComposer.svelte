<script lang="ts">
  import { Image, LoaderCircle, RotateCcw, X } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { attachmentVariantUrl } from '$lib/api/attachments';
  import AttachmentLightbox from './AttachmentLightbox.svelte';
  import type { AttachmentComposeStore } from './attachment-compose.svelte';
  import './attachment.css';

  let { store, disabled = false }: { store: AttachmentComposeStore; disabled?: boolean } = $props();

  let viewing = $state(-1);

  function remove(draft: AttachmentComposeStore['drafts'][number]): void {
    void store.remove(draft);
  }

  function draftSource(draft: AttachmentComposeStore['drafts'][number]): string {
    return draft.previewUrl || attachmentVariantUrl(draft.id, 'preview');
  }

  // The moment you most want a closer look at a pasted screenshot is before you
  // send it, so a pending image opens in the same viewer a sent one does.
  const viewable = $derived(
    store.drafts.filter((draft) => Boolean(draft.previewUrl) || draft.state === 'ready')
  );
  const items = $derived(
    viewable.map((draft) => ({ src: draftSource(draft), alt: draft.file?.name || 'Изображение' }))
  );

  function view(draft: AttachmentComposeStore['drafts'][number]): void {
    const index = viewable.findIndex((candidate) => candidate.id === draft.id);
    if (index >= 0) viewing = index;
  }
</script>

{#if store.drafts.length}
  <section class="attachment-composer" aria-label="Изображения к сообщению">
    <ol class="attachment-draft-list">
      {#each store.drafts as draft, index (draft.id)}
        <li class="attachment-draft" data-state={draft.error ? 'failed' : draft.state}>
          {#if draft.previewUrl || draft.state === 'ready'}
            <button
              class="attachment-draft-open"
              type="button"
              aria-label={`Открыть изображение ${index + 1}`}
              onclick={() => view(draft)}
            >
              <img src={draftSource(draft)} alt={draft.file?.name || `Изображение ${index + 1}`} />
            </button>
          {:else}
            <span class="attachment-draft-placeholder"><Image {...iconSm} aria-hidden="true" /></span>
          {/if}

          {#if draft.state !== 'ready' && !draft.error}
            <span
              class="attachment-draft-loading"
              style={`--attachment-progress:${Math.round(draft.progress * 100)}%`}
              role="status"
              aria-label={draft.state === 'processing' ? 'Обработка изображения' : `Загрузка изображения ${Math.round(draft.progress * 100)}%`}
            >
              <LoaderCircle {...iconSm} aria-hidden="true" />
            </span>
          {/if}

          {#if draft.error || draft.state === 'failed'}
            <button
              class="attachment-draft-retry"
              type="button"
              aria-label="Повторить загрузку"
              title={draft.error || 'Не удалось обработать изображение'}
              disabled={disabled}
              onclick={() => void store.retry(draft)}
            >
              <RotateCcw {...iconSm} aria-hidden="true" />
            </button>
          {/if}

          <button
            class="attachment-draft-remove"
            type="button"
            aria-label={`Удалить изображение ${index + 1}`}
            disabled={disabled}
            onclick={() => remove(draft)}
          >
            <X {...iconSm} aria-hidden="true" />
          </button>
        </li>
      {/each}
    </ol>
  </section>
{/if}
{#if store.lastError}<p class="attachment-compose-error" role="alert">{store.lastError}</p>{/if}

{#if viewing >= 0 && items.length}
  <AttachmentLightbox {items} index={viewing} onclose={() => (viewing = -1)} />
{/if}
