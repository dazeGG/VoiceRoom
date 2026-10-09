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
  const viewable = $derived(store.drafts.filter((draft) => Boolean(draft.previewUrl) || draft.state === 'ready'));
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
              aria-label={draft.state === 'processing'
                ? 'Обработка изображения'
                : `Загрузка изображения ${Math.round(draft.progress * 100)}%`}
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
              {disabled}
              onclick={() => void store.retry(draft)}
            >
              <RotateCcw {...iconSm} aria-hidden="true" />
            </button>
          {/if}

          <button
            class="attachment-draft-remove"
            type="button"
            aria-label={`Удалить изображение ${index + 1}`}
            {disabled}
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

<style>
  :global(.attachment-composer) {
    min-width: 0;
    padding: 12px 12px 0;
  }
  :global(.attachment-compose-error) {
    margin: 6px 12px 0;
    color: var(--vr-danger);
    font-size: 12px;
  }
  :global(.attachment-draft-open) {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    cursor: zoom-in;
  }
  :where(.attachment-draft-open) img {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    object-fit: cover;
  }
  :where(.attachment-draft-open):focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: 2px;
  }
  :global(.attachment-draft-list) {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  :global(.attachment-draft) {
    position: relative;
    width: 72px;
    height: 72px;
    flex: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: var(--vr-bg);
  }
  :global(.attachment-draft > img) {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    object-fit: cover;
  }
  :global(.attachment-draft-placeholder) {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
    color: var(--vr-text-2);
  }
  :global(.attachment-draft-loading) {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: white;
    overflow: hidden;
    border-radius: inherit;
    background: color-mix(in srgb, var(--vr-bg) 56%, transparent);
    backdrop-filter: brightness(0.68);
  }
  :global(.attachment-draft-loading svg) {
    box-sizing: content-box;
    padding: 8px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--vr-bg) 82%, transparent);
    animation: attachment-spin 0.9s linear infinite;
  }
  :global(.attachment-draft-remove),
  :global(.attachment-draft-retry) {
    position: absolute;
    z-index: 2;
    display: grid;
    width: 26px;
    height: 26px;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 50%;
    color: white;
    background: color-mix(in srgb, var(--vr-bg) 90%, transparent);
    cursor: pointer;
    transition:
      opacity 0.14s ease,
      transform 0.14s ease,
      background 0.14s ease;
  }
  :global(.attachment-draft-remove) {
    top: -6px;
    right: -6px;
    width: 22px;
    height: 22px;
    border: 2px solid var(--vr-bg);
    color: white;
    background: var(--vr-danger);
    box-shadow: 0 2px 7px color-mix(in srgb, var(--vr-bg) 66%, transparent);
    opacity: 0;
  }
  :where(.attachment-draft):hover .attachment-draft-remove,
  :where(.attachment-draft):focus-within .attachment-draft-remove {
    opacity: 1;
  }
  :where(.attachment-draft-remove):not(:disabled):hover {
    background: color-mix(in oklch, var(--vr-danger), var(--vr-bg) 16%);
  }
  :where(.attachment-draft-remove):focus-visible {
    outline: 2px solid white;
    outline-offset: 2px;
  }
  :global(.attachment-draft-retry) {
    right: 5px;
    bottom: 5px;
  }
</style>
