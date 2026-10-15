<script lang="ts">
  // The platform administrator's panel: what is happening now, how the product
  // changes, how the server is doing, and the reports. Opens inside the app
  // (a call keeps going) and as its own page at /admin.
  import { resolve } from '$app/paths';
  import { SegmentControl } from '$lib/shared/ui';
  import AdminOverview from './AdminOverview.svelte';
  import AdminProduct from './AdminProduct.svelte';
  import AdminSystem from './AdminSystem.svelte';
  import ReportsReview from './ReportsReview.svelte';
  import type { AdminTab } from './tabs';

  let { tab = $bindable('overview'), standalone = false }: { tab?: AdminTab; standalone?: boolean } = $props();

  function selectTab(value: AdminTab): void {
    tab = value;
  }

  const TABS: { value: AdminTab; label: string }[] = [
    { value: 'overview', label: 'Обзор' },
    { value: 'product', label: 'Продукт' },
    { value: 'system', label: 'Сервер' },
    { value: 'reports', label: 'Жалобы' }
  ];
</script>

<div class="admin-panel" class:is-standalone={standalone}>
  <header class="admin-head">
    {#if standalone}<a class="admin-back" href={resolve('/')}>← Voice Room</a>{/if}
    <h1>Админка</h1>
    <SegmentControl kind="tabs" options={TABS} value={tab} onChange={selectTab} ariaLabel="Разделы" />
  </header>

  <div class="admin-body" role="tabpanel" aria-label={TABS.find((item) => item.value === tab)?.label}>
    {#if tab === 'overview'}
      <AdminOverview onOpenReports={() => (tab = 'reports')} />
    {:else if tab === 'product'}
      <AdminProduct />
    {:else if tab === 'system'}
      <AdminSystem />
    {:else}
      <ReportsReview />
    {/if}
  </div>
</div>

<style>
  .admin-panel {
    display: grid;
    align-content: start;
    gap: 18px;
    width: 100%;
    max-width: 1180px;
    min-width: 0;
    height: 100%;
    margin: 0 auto;
    padding: 20px 24px 48px;
    overflow-y: auto;
    color: var(--vr-text);
    font-family: var(--font-ui);
  }

  .admin-panel.is-standalone {
    height: auto;
    min-height: 100dvh;
    overflow: visible;
    padding: 24px 16px 64px;
  }

  .admin-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
  }

  .admin-head h1 {
    margin: 0;
    font-size: 22px;
  }

  .admin-back {
    flex-basis: 100%;
    color: var(--vr-text-2);
  }

  .admin-body {
    display: grid;
    gap: 22px;
    min-width: 0;
  }
</style>
