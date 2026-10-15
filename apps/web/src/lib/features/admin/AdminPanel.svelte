<script lang="ts">
  // The platform administrator's panel: the dashboard, how the product
  // changes, how the server is doing, and the reports. It opens inside the
  // lobby, so a call keeps going; the lobby keeps the tab in the address.
  import { SegmentControl } from '$lib/shared/ui';
  import AdminAccounts from './AdminAccounts.svelte';
  import AdminOverview from './AdminOverview.svelte';
  import AdminProduct from './AdminProduct.svelte';
  import AdminSystem from './AdminSystem.svelte';
  import ReportsReview from './ReportsReview.svelte';
  import type { AdminTab } from './tabs';

  let {
    tab = 'overview',
    onTabChange,
    accountId = null,
    onAccountChange,
    openReports = 0,
    reportsVersion = 0
  }: {
    tab?: AdminTab;
    onTabChange?: (tab: AdminTab) => void;
    /** The account whose card the accounts tab shows. */
    accountId?: string | null;
    onAccountChange?: (accountId: string | null) => void;
    /** The badge on the reports tab. */
    openReports?: number;
    /** Bumped when the open reports change, so an open list reloads. */
    reportsVersion?: number;
  } = $props();

  // Without a listener the panel switches tabs itself.
  let localTab = $state<AdminTab | null>(null);
  const current = $derived(onTabChange ? tab : (localTab ?? tab));

  function selectTab(value: AdminTab): void {
    if (onTabChange) onTabChange(value);
    else localTab = value;
  }

  // Without a listener the panel opens cards itself too.
  let localAccountId = $state<string | null>(null);
  const currentAccountId = $derived(onAccountChange ? accountId : localAccountId);

  function openAccount(value: string | null): void {
    if (onAccountChange) onAccountChange(value);
    else localAccountId = value;
  }
</script>

{#snippet reportsCount()}
  {#if openReports > 0}<span class="admin-tab-count" aria-label={`открытых: ${openReports}`}>{openReports}</span>{/if}
{/snippet}

<div class="admin-panel">
  <header class="admin-head">
    <h1>Админка</h1>
    <SegmentControl
      kind="tabs"
      options={[
        { value: 'overview', label: 'Обзор' },
        { value: 'product', label: 'Продукт' },
        { value: 'system', label: 'Сервер' },
        { value: 'accounts', label: 'Аккаунты' },
        { value: 'reports', label: 'Жалобы', suffix: reportsCount }
      ]}
      value={current}
      onChange={selectTab}
      ariaLabel="Разделы"
    />
  </header>

  <div class="admin-body" role="tabpanel">
    {#if current === 'overview'}
      <AdminOverview onOpenReports={() => selectTab('reports')} />
    {:else if current === 'product'}
      <AdminProduct />
    {:else if current === 'system'}
      <AdminSystem />
    {:else if current === 'accounts'}
      <AdminAccounts accountId={currentAccountId} onOpenAccount={openAccount} />
    {:else}
      {#key reportsVersion}<ReportsReview />{/key}
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

  .admin-body {
    display: grid;
    gap: 22px;
    min-width: 0;
  }

  .admin-tab-count {
    display: inline-grid;
    min-width: 18px;
    height: 18px;
    margin-left: 6px;
    padding: 0 5px;
    place-items: center;
    border-radius: 999px;
    background: var(--vr-danger);
    color: var(--vr-on-danger);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
