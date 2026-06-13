<script lang="ts">
  import type { Snippet } from 'svelte';
  import './topbar.css';

  let {
    label = 'На главную Voice Room',
    reload = false,
    children
  }: { label?: string; reload?: boolean; children?: Snippet } = $props();
</script>

<header class="topbar">
  <a class="brand" href="/" aria-label={label} data-sveltekit-reload={reload ? '' : undefined}>
    <img class="brand-mark" src="/icon.svg" width="32" height="32" alt="" aria-hidden="true">
    <span>Voice Room</span>
  </a>
  {#if children}{@render children()}{/if}
</header>
