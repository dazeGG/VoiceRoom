<script lang="ts">
  // Every account of the service: found by name or login, narrowed by a
  // filter, sorted by any column, a page at a time. A row opens the account's
  // card; the list keeps its search, filter and page meanwhile.
  import { displayNameOf } from '$lib/shared/utils/display-name';
  import { onMount } from 'svelte';
  import { ArrowDown, ArrowUp, Globe, Monitor, Search, Smartphone } from '@lucide/svelte';
  import { fetchAccounts, type AccountsPage, type AccountsSort } from '$lib/api/admin';
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { AccountBadge, Avatar, Button, Select } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import AdminAccountCard from './AdminAccountCard.svelte';
  import AdminNotice from './AdminNotice.svelte';
  import { ACCOUNT_FILTERS, SORT_COLUMNS, isAccountsFilter } from './accounts';
  import { formatAgo, formatCount, formatDate, formatMinutes } from './format';
  import { loadFailure, type LoadFailure } from './load-state';

  let {
    accountId = null,
    onOpenAccount
  }: {
    /** The account whose card is open; null shows the list. */
    accountId?: string | null;
    onOpenAccount: (accountId: string | null) => void;
  } = $props();

  const SEARCH_DELAY_MS = 250;

  let q = $state('');
  let filter = $state<(typeof ACCOUNT_FILTERS)[number]['value']>('all');
  let sort = $state<AccountsSort>('created');
  let order = $state<'asc' | 'desc'>('desc');
  let pageNumber = $state(1);
  let page = $state<AccountsPage | null>(null);
  let failure = $state<LoadFailure | null>(null);
  let loading = $state(false);
  let now = $state(Date.now());
  let request = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  async function load(): Promise<void> {
    loading = true;
    // A slower answer for a query already left behind is dropped.
    const mine = ++request;
    try {
      const loaded = await fetchAccounts({
        ...(q.trim() ? { q: q.trim() } : {}),
        filter,
        sort,
        order,
        page: String(pageNumber)
      });
      if (mine !== request) return;
      page = loaded;
      failure = null;
      now = Date.now();
    } catch (cause) {
      if (mine === request) failure = loadFailure(cause, 'Не удалось загрузить аккаунты');
    } finally {
      if (mine === request) loading = false;
    }
  }

  function onSearchInput(): void {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      pageNumber = 1;
      void load();
    }, SEARCH_DELAY_MS);
  }

  function changeFilter(value: string): void {
    if (!isAccountsFilter(value)) return;
    filter = value;
    pageNumber = 1;
    void load();
  }

  function sortBy(column: (typeof SORT_COLUMNS)[number]): void {
    if (sort === column.sort) order = order === 'asc' ? 'desc' : 'asc';
    else {
      sort = column.sort;
      order = column.first;
    }
    pageNumber = 1;
    void load();
  }

  function goToPage(next: number): void {
    pageNumber = next;
    void load();
  }

  // Back from a card, the list shows what the card may have changed.
  function closeCard(): void {
    onOpenAccount(null);
    void load();
  }

  onMount(() => {
    void load();
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });

  const accounts = $derived(page?.accounts ?? []);
  const lastPage = $derived(page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1);
  const shownFrom = $derived(page && page.total ? (page.page - 1) * page.pageSize + 1 : 0);
  const shownTo = $derived(page ? Math.min(page.total, page.page * page.pageSize) : 0);

  const sortLabel = (column: (typeof SORT_COLUMNS)[number]) =>
    sort === column.sort ? `${column.label}, ${order === 'asc' ? 'по возрастанию' : 'по убыванию'}` : column.label;
</script>

{#if accountId}
  <AdminAccountCard userId={accountId} onBack={closeCard} />
{:else}
  <div class="acc-toolbar">
    <label class="acc-search">
      <Search {...iconSm} aria-hidden="true" />
      <input
        type="search"
        placeholder="Имя, логин или id"
        aria-label="Поиск аккаунта"
        maxlength="100"
        bind:value={q}
        oninput={onSearchInput}
      />
    </label>
    <div class="acc-filter">
      <Select value={filter} options={ACCOUNT_FILTERS} label="Показать" variant="field" onValueChange={changeFilter} />
    </div>
    {#if page}
      <span class="acc-quiet">
        {page.total ? `${formatCount(shownFrom)}–${formatCount(shownTo)} из ${formatCount(page.total)}` : 'Никого'}
        {#if loading}· обновляем…{/if}
      </span>
    {/if}
  </div>

  {#if failure && !page}
    <AdminNotice {failure} onRetry={() => void load()} />
  {:else if !page}
    <p class="acc-quiet" aria-busy="true">Загружаем…</p>
  {:else if accounts.length === 0}
    <p class="acc-quiet">Под этот поиск никто не подходит.</p>
  {:else}
    {#if failure}<p class="acc-error" role="alert">{failure.message}</p>{/if}
    <div class="acc-table-wrap">
      <table class="acc-table">
        <thead>
          <tr>
            {#each SORT_COLUMNS as column (column.sort)}
              <th
                scope="col"
                class:is-number={column.sort !== 'name' && column.sort !== 'created' && column.sort !== 'lastSeen'}
                aria-sort={sort === column.sort ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" class="acc-sort" aria-label={sortLabel(column)} onclick={() => sortBy(column)}>
                  {column.label}
                  {#if sort === column.sort}
                    {#if order === 'asc'}<ArrowUp size={13} aria-hidden="true" />{:else}<ArrowDown
                        size={13}
                        aria-hidden="true"
                      />{/if}
                  {/if}
                </button>
              </th>
            {/each}
            <th scope="col">Откуда</th>
          </tr>
        </thead>
        <tbody>
          {#each accounts as account (account.id)}
            <!-- The whole row opens the card for the mouse; its first cell's button is the keyboard's way. -->
            <tr onclick={() => onOpenAccount(account.id)}>
              <td>
                <button
                  type="button"
                  class="acc-person"
                  onclick={(event) => {
                    event.stopPropagation();
                    onOpenAccount(account.id);
                  }}
                >
                  <Avatar
                    name={displayNameOf(account)}
                    src={account.avatarUrl}
                    colorKey={account.avatarColorKey}
                    background={account.avatarAccent}
                    size={32}
                    showDot={account.online}
                    online={account.online}
                  />
                  <span class="acc-person-text">
                    <span class="acc-person-name"
                      ><EmojiText text={displayNameOf(account)} /><AccountBadge userId={account.id} /></span
                    >
                    <span class="acc-person-login">@{account.login}</span>
                  </span>
                  {#if account.admin}<span class="acc-chip" data-tone="accent">админ</span>{/if}
                  {#if account.status === 'blocked'}<span class="acc-chip" data-tone="danger">заблокирован</span>{/if}
                  {#if account.status === 'deleting'}<span class="acc-chip" data-tone="danger">удаляется</span>{/if}
                </button>
              </td>
              <td>{formatDate(account.createdAt)}</td>
              <td>{account.online ? 'в сети' : formatAgo(account.lastSeenAt, now)}</td>
              <td class="is-number">{formatCount(account.activeDays)}</td>
              <td class="is-number">{formatMinutes(account.voiceMinutes)}</td>
              <td class="is-number">{formatCount(account.messages)}</td>
              <td class="is-number" class:has-reports={account.reportsAgainst > 0}>
                {account.reportsAgainst ? formatCount(account.reportsAgainst) : '—'}
              </td>
              <td>
                <span class="acc-clients">
                  {#if account.clients.desktopApp}<span title="Приложение" aria-label="Приложение"
                      ><Monitor size={14} aria-hidden="true" /></span
                    >{/if}
                  {#if account.clients.browser}<span title="Браузер" aria-label="Браузер"
                      ><Globe size={14} aria-hidden="true" /></span
                    >{/if}
                  {#if account.clients.mobile}<span title="Телефон" aria-label="Телефон"
                      ><Smartphone size={14} aria-hidden="true" /></span
                    >{/if}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if lastPage > 1}
      <nav class="acc-pages" aria-label="Страницы">
        <Button variant="outline" disabled={pageNumber <= 1 || loading} onclick={() => goToPage(pageNumber - 1)}
          >Назад</Button
        >
        <span class="acc-quiet">Страница {pageNumber} из {lastPage}</span>
        <Button variant="outline" disabled={pageNumber >= lastPage || loading} onclick={() => goToPage(pageNumber + 1)}
          >Дальше</Button
        >
      </nav>
    {/if}
    <p class="acc-quiet">«Откуда» — клиенты за последние 30 дней. Активные дни считаются с 15 октября 2026.</p>
  {/if}
{/if}

<style>
  .acc-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }

  .acc-search {
    display: flex;
    flex: 1 1 240px;
    align-items: center;
    gap: 8px;
    max-width: 360px;
    height: 38px;
    padding: 0 12px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 10px;
    background: var(--vr-surface);
    color: var(--vr-text-3);
  }

  .acc-search:focus-within {
    border-color: var(--vr-accent-line);
  }

  .acc-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--vr-text);
    font: inherit;
    font-size: 14px;
  }

  .acc-filter {
    min-width: 200px;
  }

  .acc-quiet {
    margin: 0;
    color: var(--vr-text-3);
    font-size: 12.5px;
  }

  .acc-error {
    margin: 0;
    color: var(--vr-danger);
  }

  .acc-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .acc-table {
    width: 100%;
    min-width: 860px;
    border-collapse: collapse;
    font-size: 13.5px;
  }

  .acc-table th,
  .acc-table td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vr-line);
    color: var(--vr-text-2);
    text-align: left;
    white-space: nowrap;
  }

  .acc-table tbody tr:last-child td {
    border-bottom: 0;
  }

  .acc-table tbody tr {
    cursor: pointer;
  }

  .acc-table tbody tr:hover td {
    background: var(--vr-hover);
  }

  .acc-table th {
    padding-top: 10px;
    padding-bottom: 10px;
    color: var(--vr-text-3);
    font-size: 12px;
    font-weight: 600;
  }

  .acc-table .is-number {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .acc-table th.is-number .acc-sort {
    margin-left: auto;
  }

  .acc-sort {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .acc-sort:hover {
    color: var(--vr-text);
  }

  .acc-person {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .acc-person-text {
    display: grid;
    min-width: 0;
  }

  .acc-person-name {
    max-width: 240px;
    overflow: hidden;
    color: var(--vr-text);
    font-weight: 600;
    text-overflow: ellipsis;
  }

  .acc-person-login {
    color: var(--vr-text-3);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .acc-chip {
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
  }

  .acc-chip[data-tone='accent'] {
    background: var(--vr-accent-soft);
    color: var(--vr-accent);
  }

  .acc-chip[data-tone='danger'] {
    background: var(--vr-danger-soft);
    color: var(--vr-danger);
  }

  .acc-table td.has-reports {
    color: var(--vr-danger);
    font-weight: 600;
  }

  .acc-clients {
    display: inline-flex;
    gap: 6px;
    color: var(--vr-text-3);
  }

  .acc-pages {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
</style>
