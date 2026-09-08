<script lang="ts">
  // One reaction emoji, drawn from the bundled OpenMoji artwork so it looks the
  // same on every OS — see emoji-asset.ts for why the platform font is not
  // enough. The character itself stays the alt text, so selecting, copying and
  // screen readers all still see an emoji rather than a picture of one, and a
  // failed image load falls back to it.
  import { emojiAssetUrl } from './emoji-asset';

  let {
    emoji,
    size = 22,
    decorative = false
  }: {
    emoji: string;
    /** Rendered box in px; the artwork is square. */
    size?: number;
    /** True when a parent already names this emoji, e.g. in its aria-label. */
    decorative?: boolean;
  } = $props();

  let failed = $state(false);
  const url = $derived(emojiAssetUrl(emoji));

  // A different emoji deserves a fresh attempt at its own file.
  $effect(() => {
    url;
    failed = false;
  });
</script>

{#if failed}
  <span class="emoji emoji-text" style:--emoji-size={`${size}px`} aria-hidden={decorative || undefined}
    >{emoji}</span
  >
{:else}
  <img
    class="emoji"
    style:--emoji-size={`${size}px`}
    src={url}
    alt={decorative ? '' : emoji}
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

  /* The platform font is the last resort, so it has to land on the same box. */
  .emoji-text {
    font-size: calc(var(--emoji-size, 22px) * 0.92);
    line-height: var(--emoji-size, 22px);
    text-align: center;
  }
</style>
