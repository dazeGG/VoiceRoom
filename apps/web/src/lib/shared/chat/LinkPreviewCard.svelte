<script lang="ts">
  import { linkPreviewImageUrl, type LinkPreview } from '@voice-room/shared/link-preview';
  import EmojiText from './EmojiText.svelte';

  let { preview }: { preview: LinkPreview } = $props();

  // The image is the copy the server stored, never the linked site's own file.
  const imageUrl = $derived(preview.image ? linkPreviewImageUrl(preview.image.key) : null);
</script>

<!-- A compact card that sits under the message rather than taking it over: the
     picture as a thumbnail on the left, and on the right the site, a one-line
     title and at most two lines of description. -->
<a
  class="link-preview"
  class:link-preview--with-image={Boolean(imageUrl)}
  href={preview.url}
  target="_blank"
  rel="noopener noreferrer nofollow"
>
  {#if imageUrl && preview.image}
    <span class="link-preview__thumb">
      <img
        class="link-preview__image"
        src={imageUrl}
        alt=""
        width={preview.image.width}
        height={preview.image.height}
        loading="lazy"
        decoding="async"
      />
    </span>
  {/if}
  <span class="link-preview__text">
    <span class="link-preview__site"><EmojiText text={preview.siteName} /></span>
    {#if preview.title}<strong class="link-preview__title"><EmojiText text={preview.title} /></strong>{/if}
    {#if preview.description}<span class="link-preview__description"><EmojiText text={preview.description} /></span
      >{/if}
  </span>
</a>

<style>
  .link-preview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: min(100%, 440px);
    margin-top: 6px;
    overflow: hidden;
    border-inline-start: 3px solid color-mix(in oklch, var(--green), transparent 25%);
    border-radius: 6px;
    background: color-mix(in oklch, currentColor, transparent 94%);
    color: inherit;
    text-decoration: none;
  }

  .link-preview--with-image {
    grid-template-columns: 96px minmax(0, 1fr);
  }

  .link-preview:hover,
  .link-preview:focus-visible {
    background: color-mix(in oklch, currentColor, transparent 90%);
  }

  /* The text decides how tall the card is; the thumbnail only fills that
     height. Laid out on its own, a square logo stretched a two-line card to
     96px, so the picture is taken out of the flow and cropped to cover. */
  .link-preview__thumb {
    position: relative;
    width: 96px;
    min-height: 64px;
    overflow: hidden;
  }

  .link-preview__image {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .link-preview__text {
    display: grid;
    align-content: center;
    min-width: 0;
    gap: 1px;
    padding: 7px 10px;
  }

  .link-preview__site,
  .link-preview__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-preview__site {
    opacity: 0.6;
    font-size: 0.68rem;
  }

  .link-preview__title {
    font-size: 0.8rem;
    line-height: 1.3;
  }

  .link-preview__description {
    display: -webkit-box;
    overflow: hidden;
    opacity: 0.72;
    font-size: 0.74rem;
    line-height: 1.35;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
</style>
