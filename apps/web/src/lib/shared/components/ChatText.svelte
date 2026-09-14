<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { parseChatLinks } from '$lib/shared/utils/linkify';

  let { text = '' }: { text?: string } = $props();

  const segments = $derived(parseChatLinks(text));
</script>

{#each segments as seg, i (i)}
  {#if seg.kind === 'link' && seg.href}
    <a href={seg.href} target="_blank" rel="noopener noreferrer nofollow">{seg.text}</a>
  {:else}
    <EmojiText text={seg.text} />
  {/if}
{/each}

<style>
  a {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>
