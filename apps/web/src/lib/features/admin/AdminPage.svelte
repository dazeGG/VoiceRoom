<script lang="ts">
  // The admin panel as its own page, for /admin and /admin/reports.
  import AdminPanel from './AdminPanel.svelte';
  import type { AdminTab } from './tabs';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';

  let { tab = 'overview' }: { tab?: AdminTab } = $props();
</script>

<svelte:head>
  <title>Админка · Voice Room</title>
  <meta name="theme-color" content="#131416" />
</svelte:head>

<AdminPanel standalone {tab} />
