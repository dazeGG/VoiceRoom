<script lang="ts">
  import type { Snippet } from 'svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';
  import './styles/auth.css';

  let { children }: { children: Snippet } = $props();
</script>

<div class="auth-screen">
  <a class="auth-brand" href="/" aria-label="На главную Voice Room" data-sveltekit-reload>
    <img src="/icon.svg" width="30" height="30" alt="" aria-hidden="true" />
    <span>Voice Room</span>
  </a>

  <div class="auth-card">
    {@render children()}
  </div>
</div>
