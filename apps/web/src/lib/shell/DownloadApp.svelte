<script lang="ts">
  import { onMount } from 'svelte';
  import downloadShell from '$lib/legacy/download-shell.html?raw';
  import '$lib/legacy/shared/topbar.css';
  import '$lib/legacy/download/download.css';

  onMount(() => {
    void import('$lib/legacy/download/main');
  });
</script>

{@html downloadShell}
