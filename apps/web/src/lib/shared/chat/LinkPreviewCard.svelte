<script lang="ts">
  import { linkPreviewImageUrl, type LinkPreview } from '@voice-room/shared/link-preview';
  import EmojiText from './EmojiText.svelte';

  let { preview }: { preview: LinkPreview } = $props();

  // The image is the copy the server stored, never the linked site's own file.
  const imageUrl = $derived(preview.image ? linkPreviewImageUrl(preview.image.key) : null);
</script>

<a class="link-preview" href={preview.url} target="_blank" rel="noopener noreferrer nofollow">
  {#if imageUrl && preview.image}
    <img
      class="link-preview__image"
      src={imageUrl}
      alt=""
      width={preview.image.width}
      height={preview.image.height}
      loading="lazy"
      decoding="async"
    />
  {/if}
  <span class="link-preview__text">
    <span class="link-preview__site"><EmojiText text={preview.siteName} /></span>
    {#if preview.title}<strong class="link-preview__title"><EmojiText text={preview.title} /></strong>{/if}
    {#if preview.description}<span class="link-preview__description"><EmojiText text={preview.description} /></span>{/if}
  </span>
</a>

<style>
  .link-preview {
    display: grid;
    width: min(100%, 420px);
    margin-top: 6px;
    overflow: hidden;
    border-inline-start: 3px solid color-mix(in oklch, var(--green), transparent 25%);
    border-radius: 6px;
    background: color-mix(in oklch, currentColor, transparent 94%);
    color: inherit;
    text-decoration: none;
  }

  .link-preview:hover,
  .link-preview:focus-visible {
    background: color-mix(in oklch, currentColor, transparent 90%);
  }

  .link-preview__image {
    display: block;
    width: 100%;
    height: auto;
    max-height: 220px;
    object-fit: cover;
  }

  .link-preview__text {
    display: grid;
    min-width: 0;
    gap: 2px;
    padding: 8px 10px;
  }

  .link-preview__site {
    opacity: 0.65;
    font-size: 0.72rem;
  }

  .link-preview__title,
  .link-preview__description {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
  }

  .link-preview__title {
    font-size: 0.85rem;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .link-preview__description {
    opacity: 0.75;
    font-size: 0.8rem;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }
</style>
