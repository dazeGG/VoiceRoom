<script lang="ts">
  import type { Snippet } from 'svelte';
  import BetaMark from './BetaMark.svelte';
  import './topbar.css';

  let {
    label = 'На главную VoiceRoom',
    reload = false,
    children
  }: { label?: string; reload?: boolean; children?: Snippet } = $props();
</script>

<header class="topbar">
  <a class="brand" href="/" aria-label={label} data-sveltekit-reload={reload ? '' : undefined}>
    <span class="brand-mark" aria-hidden="true"></span>
    <span>VoiceRoom</span>
    <BetaMark />
  </a>
  {#if children}{@render children()}{/if}
</header>

<style>
  :global(.brand-mark) {
    width: 24px;
    height: 24px;
    display: block;
    flex: 0 0 auto;
    background: var(--vr-accent);
    mask: url('/voiceroom-mascot.svg') center / contain no-repeat;
  }
</style>
