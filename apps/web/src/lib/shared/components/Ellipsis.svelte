<script lang="ts">
  import type { Snippet } from 'svelte';
  import '$lib/shared/styles/ellipsis.css';

  let {
    text = '',
    title,
    class: className = '',
    inline = false,
    tag = 'span',
    children
  }: {
    text?: string;
    title?: string;
    class?: string;
    inline?: boolean;
    tag?: keyof HTMLElementTagNameMap;
    children?: Snippet;
  } = $props();

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