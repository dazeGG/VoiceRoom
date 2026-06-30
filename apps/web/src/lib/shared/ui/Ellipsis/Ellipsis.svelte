<script lang="ts">
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
</script>

<svelte:element
  this={tag}
  class={`ellipsis ${className}`.trim()}
  class:ellipsis--inline={inline}
  title={resolvedTitle || undefined}
>
  {#if children}
    {@render children()}
  {:else}
    {text}
  {/if}
</svelte:element>

<style>
  /* Single-line truncation. Static `ellipsis` class + `class:` directive keep these
     selectors visible to Svelte's scoping, so no global stylesheet is needed. */
  .ellipsis {
    display: block;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ellipsis--inline {
    display: inline-block;
    vertical-align: bottom;
  }
</style>
