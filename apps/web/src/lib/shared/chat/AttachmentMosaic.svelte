<script lang="ts">
  import type { MessageAttachment } from '@voice-room/shared/attachments';
  import { attachmentVariantUrl } from '../../api/attachments';
  import AttachmentLightbox from './AttachmentLightbox.svelte';
  import './attachment.css';

  let { attachments = [] }: { attachments?: MessageAttachment[] } = $props();
  let selected = $state(-1);
  const ready = $derived(attachments.filter((attachment) => attachment.state === 'ready'));
</script>

{#if attachments.length}
  <div class="attachment-mosaic" class:single={attachments.length === 1} data-count={attachments.length}>
    {#each attachments.slice(0, 4) as attachment, index (attachment.id)}
      {#if attachment.state === 'ready'}
        <button type="button" class="attachment-tile" onclick={() => { selected = ready.findIndex((item) => item.id === attachment.id); }}
          aria-label={`Открыть изображение ${index + 1} из ${attachments.length}`}
          style={`--attachment-aspect:${attachment.width}/${attachment.height}`}>
          <img src={attachment.url || attachmentVariantUrl(attachment.id, 'preview')} alt="" loading="lazy"
            width={attachment.width} height={attachment.height} decoding="async" />
        </button>
      {:else}
        <div class="attachment-tile attachment-unavailable" role="img" aria-label="Изображение недоступно">
          Изображение недоступно
        </div>
      {/if}
    {/each}
  </div>
{/if}

{#if selected >= 0}
  <AttachmentLightbox attachments={ready} index={selected} onclose={() => { selected = -1; }} />
{/if}
