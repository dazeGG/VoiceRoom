<script lang="ts">
  // One emoji, drawn from the bundled Twemoji artwork so it looks the same on
  // every OS — see emoji-asset.ts for why the platform font is not enough. The
  // character itself stays the alt text, so selecting, copying and screen
  // readers all still see an emoji rather than a picture of one, and a failed
  // image load falls back to it.
  import { emojiAssetUrl } from './emoji-asset';

  let {
    emoji,
    size = 22,
    decorative = false,
    inline = false
  }: {
    emoji: string;
    /** Rendered box: px as a number, or any CSS length such as '1.375em'. */
    size?: number | string;
    /** True when a parent already names this emoji, e.g. in its aria-label. */
    decorative?: boolean;
    /** Sits in running text, sized and aligned against the surrounding line. */
    inline?: boolean;
  } = $props();

  let failed = $state(false);
  const url = $derived(emojiAssetUrl(emoji));
  const box = $derived(typeof size === 'number' ? `${size}px` : size);

  // A different emoji deserves a fresh attempt at its own file.
  $effect(() => {
    url;
    failed = false;
  });
</script>

{#if failed}
  <span class="emoji emoji-text" class:emoji-inline={inline} style:--emoji-size={box} aria-hidden={decorative || undefined}
    >{emoji}</span
  >
{:else}
  <img
    class="emoji"
    class:emoji-inline={inline} style:--emoji-size={box}
    src={url}
    alt={decorative ? '' : emoji}
    data-emoji={emoji}
    draggable="false"
    loading="lazy"
    decoding="async"
    onerror={() => (failed = true)}
  />
{/if}

<style>
  .emoji {
    display: inline-block;
    width: var(--emoji-size, 22px);
    height: var(--emoji-size, 22px);
    vertical-align: -0.15em;
    user-select: none;
  }

  /* In running text: a little larger than the letters and resting on the line
     rather than floating above it, with a hair of space from its neighbours. */
  /* Selectable like the letters around it, so a selection that crosses it
     copies it too (see emoji-copy.ts). */
  .emoji-inline {
    margin: 0 0.05em 0 0.1em;
    vertical-align: -0.3em;
    user-select: auto;
  }

  /* The platform font is the last resort, so it has to land on the same box. */
  .emoji-text {
    font-size: calc(var(--emoji-size, 22px) * 0.92);
    line-height: var(--emoji-size, 22px);
    text-align: center;
  }
</style>
