<script lang="ts">
  import './ellipsis.css';
  import type { EllipsisProps } from './types';

  let {
    text = '',
    title,
    class: className = '',
    inline = false,
    tag = 'span',
    children
  }: EllipsisProps = $props();

  const resolvedTitle = $derived(title ?? text);
  const classes = $derived(
    ['ellipsis', inline ? 'ellipsis--inline' : '', className].filter(Boolean).join(' ')
  );
</script>

<svelte:element this={tag} class={classes} title={resolvedTitle || undefined}>
  {#if children}
    {@render children()}
  {:else}
    {text}
  {/if}
</svelte:element>
