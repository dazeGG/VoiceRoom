<script lang="ts">
  import { parseChatLinks } from '$lib/shared/utils/linkify';

  let { text = '' }: { text?: string } = $props();

  const segments = $derived(parseChatLinks(text));
</script>

{#each segments as seg, i (i)}
  {#if seg.kind === 'link' && seg.href}
    <a href={seg.href} target="_blank" rel="noopener noreferrer nofollow">{seg.text}</a>
  {:else}
    {seg.text}
  {/if}
{/each}
