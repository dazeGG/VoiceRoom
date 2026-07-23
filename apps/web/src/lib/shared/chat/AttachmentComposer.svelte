<script lang="ts">
  import { Image, LoaderCircle, RotateCcw, X } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { attachmentVariantUrl } from '$lib/api/attachments';
  import type { AttachmentComposeStore } from './attachment-compose.svelte';
  import './attachment.css';

  let { store, disabled = false }: { store: AttachmentComposeStore; disabled?: boolean } = $props();

  function remove(draft: AttachmentComposeStore['drafts'][number]): void {
    void store.remove(draft);
  }
</script>

{#if store.drafts.length}
  <section class="attachment-composer" aria-label="Изображения к сообщению">
    <ol class="attachment-draft-list">
      {#each store.drafts as draft, index (draft.id)}
        <li class="attachment-draft" data-state={draft.error ? 'failed' : draft.state}>
          {#if draft.previewUrl || draft.state === 'ready'}
            <img
              src={draft.previewUrl || attachmentVariantUrl(draft.id, 'preview')}
              alt={draft.file?.name || `Изображение ${index + 1}`}
            />
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
