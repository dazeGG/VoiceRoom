<script lang="ts">
  // Plain text with its emoji drawn as the bundled artwork, the way Discord
  // draws them. The image keeps the character as its alt text, so selecting
  // and copying still yields the emoji. The markup stays on one line: any
  // whitespace here would show up inside names and pre-wrapped messages.
  import Emoji from './Emoji.svelte';
  import { splitEmoji } from './emoji-text';

  let { text = '', size = '1.375em' }: { text?: string; size?: number | string } = $props();

  const parts = $derived(splitEmoji(text));
</script>

{#each parts as part, index (index)}{#if part.kind === 'emoji'}<Emoji emoji={part.emoji} {size} inline />{:else}{part.text}{/if}{/each}
