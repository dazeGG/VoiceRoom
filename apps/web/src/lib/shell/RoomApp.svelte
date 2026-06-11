<script lang="ts">
  import { onMount } from 'svelte';
  import roomShell from '$lib/legacy/room-shell.html?raw';
  import '$lib/legacy/shared/topbar.css';
  import '$lib/legacy/styles.css';

  onMount(() => {
    void import('$lib/legacy/main');
  });
</script>

{@html roomShell}
