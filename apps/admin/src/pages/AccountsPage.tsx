// Every account of the service: found by name or login, narrowed by a
// filter, sorted by any column, a page at a time. A row opens the account's
// card; the list keeps its search, filter and page meanwhile.

import { ArrowDown, ArrowUp, Globe, Monitor, Search, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AccountRow, AccountsFilter, AccountsSort } from '@voice-room/shared/contracts/admin';
import { ACCOUNT_FILTERS, SORT_COLUMNS } from '../accounts.ts';
import { fetchAccounts } from '../api/admin.ts';
import { formatAgo, formatCount, formatMinutes, formatNumericDate } from '../format.ts';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { AccountBadge, Avatar, Button, Empty, Pill, Segment } from '../ui/index.tsx';
import { AccountCard } from './AccountCard.tsx';
import './AccountsPage.css';

const SEARCH_DELAY_MS = 250;

const nameOf = (account: AccountRow) => account.displayName || account.login;

/** Columns that hold numbers line up on the right. */
const NUMERIC: ReadonlySet<AccountsSort> = new Set(['activeDays', 'voice', 'messages', 'reports']);

export function AccountsPage({
  accountId,
  onOpenAccount
}: {
  /** The account whose card is open; null shows the list. */
  accountId: string | null;
  onOpenAccount: (accountId: string | null) => void;
}) {
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AccountsFilter>('all');
  const [sort, setSort] = useState<AccountsSort>('created');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [pageNumber, setPageNumber] = useState(1);
  // A slower answer for a query already left behind is dropped.
  const {
    data: page,
    failure,
    busy: loading,
    loadedAt,
    reload
  } = useAdminResource(
    () => fetchAccounts({ filter, sort, order, page: String(pageNumber), ...(search ? { q: search } : {}) }),
    [search, filter, sort, order, pageNumber],
    { failureText: 'Не удалось загрузить аккаунты' }
  );
  const now = loadedAt ?? 0;

  // The search goes to the server a moment after the last key.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(typed.trim());
      setPageNumber(1);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);

  function changeFilter(value: AccountsFilter): void {
    setFilter(value);
    setPageNumber(1);
  }

  function sortBy(column: (typeof SORT_COLUMNS)[number]): void {
    if (sort === column.sort) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(column.sort);
      setOrder(column.first);
    }
    setPageNumber(1);
  }

  // Back from a card, the list shows what the card may have changed.
  function closeCard(): void {
    onOpenAccount(null);
    reload();
  }

  if (accountId) return <AccountCard key={accountId} userId={accountId} onBack={closeCard} />;

  const accounts = page?.accounts ?? [];
  const lastPage = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  const shownFrom = page && page.total ? (page.page - 1) * page.pageSize + 1 : 0;
  const shownTo = page ? Math.min(page.total, page.page * page.pageSize) : 0;
  const sortLabel = (column: (typeof SORT_COLUMNS)[number]) =>
    sort === column.sort ? `${column.label}, ${order === 'asc' ? 'по возрастанию' : 'по убыванию'}` : column.label;

  return (
    <>
      <div className="ui-toolbar">
        <label className="acc-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Имя, логин или id"
            aria-label="Поиск аккаунта"
            maxLength={100}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <Segment ariaLabel="Показать" value={filter} onChange={changeFilter} options={ACCOUNT_FILTERS} />
        {page ? (
          <span className="ui-toolbar-note acc-count">
            {page.total ? `${formatCount(shownFrom)}–${formatCount(shownTo)} из ${formatCount(page.total)}` : 'Никого'}
            {loading ? ' · обновляем…' : ''}
          </span>
        ) : null}
      </div>

      {failure && !page ? (
        <Notice failure={failure} onRetry={reload} />
      ) : (
        <>
          {failure ? (
            <p className="admin-error" role="alert">
              {failure.message}
            </p>
          ) : null}
          <section className="ui-panel" data-flush="true" aria-label="Аккаунты">
            {!page ? (
              <p className="ui-empty" aria-busy="true">
                Загружаем…
              </p>
            ) : accounts.length === 0 ? (
              <Empty>Под этот поиск никто не подходит</Empty>
            ) : (
              <div className="ui-table-scroll">
                <table className="acc-table">
                  <colgroup>
                    <col />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 90 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {SORT_COLUMNS.map((column) => (
                        <th
                          key={column.sort}
                          scope="col"
                          className={NUMERIC.has(column.sort) ? 'is-number' : undefined}
                          aria-sort={sort === column.sort ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <button
                            type="button"
                            className="acc-sort"
                            aria-label={sortLabel(column)}
                            onClick={() => sortBy(column)}
                          >
                            {column.label}
                            {sort === column.sort ? (
                              order === 'asc' ? (
                                <ArrowUp size={13} aria-hidden="true" />
                              ) : (
                                <ArrowDown size={13} aria-hidden="true" />
                              )
                            ) : null}
                          </button>
                        </th>
                      ))}
                      <th scope="col">Откуда</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((account) => (
                      // The whole row opens the card for the mouse; its first cell's button is the keyboard's way.
                      <tr key={account.id} onClick={() => onOpenAccount(account.id)}>
                        <td>
                          <span className="acc-person-cell">
                            <button
                              type="button"
                              className="acc-person"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenAccount(account.id);
                              }}
                            >
                              <span className="acc-avatar">
                                <Avatar
                                  name={nameOf(account)}
                                  src={account.avatarUrl}
                                  colorKey={account.avatarColorKey}
                                  background={account.avatarAccent}
                                  size={34}
                                />
                                {account.online ? <span className="acc-dot" aria-hidden="true" /> : null}
                              </span>
                              <span className="acc-person-text">
                                <span className="acc-person-name">
                                  {nameOf(account)}
                                  <AccountBadge userId={account.id} />
                                </span>
                                <span className="acc-person-login ui-mono">@{account.login}</span>
                              </span>
                            </button>
                            {account.admin ? (
                              <Pill tone="accent" compact>
                                сотрудник
                              </Pill>
                            ) : null}
                            {account.status === 'blocked' ? (
                              <Pill tone="danger" compact>
                                заблокирован
                              </Pill>
                            ) : null}
                            {account.status === 'deleting' ? (
                              <Pill tone="danger" compact>
                                удаляется
                              </Pill>
                            ) : null}
                          </span>
                        </td>
                        <td className="acc-dim ui-num">{formatNumericDate(account.createdAt)}</td>
                        <td className={account.online ? 'acc-online' : 'acc-dim'}>
                          {account.online ? 'в сети' : formatAgo(account.lastSeenAt, now)}
                        </td>
                        <td className="is-number">{formatCount(account.activeDays)}</td>
                        <td className="is-number">{formatMinutes(account.voiceMinutes)}</td>
                        <td className="is-number">{formatCount(account.messages)}</td>
                        <td className={account.reportsAgainst > 0 ? 'is-number has-reports' : 'is-number acc-none'}>
                          {account.reportsAgainst ? formatCount(account.reportsAgainst) : '—'}
                        </td>
                        <td>
                          <span className="acc-clients">
                            {account.clients.desktopApp ? (
                              <span title="Приложение" aria-label="Приложение">
                                <Monitor size={15} aria-hidden="true" />
                              </span>
                            ) : null}
                            {account.clients.browser ? (
                              <span title="Браузер" aria-label="Браузер">
                                <Globe size={15} aria-hidden="true" />
                              </span>
                            ) : null}
                            {account.clients.mobile ? (
                              <span title="Телефон" aria-label="Телефон">
                                <Smartphone size={15} aria-hidden="true" />
                              </span>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <footer className="acc-foot">
              <span className="acc-foot-note">
                «Откуда» — клиенты за последние 30 дней. Активные дни и время в войсе — за последние 90 дней: дальше
                хранятся только общие счётчики без привязки к людям.
              </span>
              {lastPage > 1 ? (
                <nav className="acc-pages" aria-label="Страницы">
                  <Button disabled={pageNumber <= 1 || loading} onClick={() => setPageNumber(pageNumber - 1)}>
                    Назад
                  </Button>
                  <span className="acc-page">
                    Страница {formatCount(pageNumber)} из {formatCount(lastPage)}
                  </span>
                  <Button disabled={pageNumber >= lastPage || loading} onClick={() => setPageNumber(pageNumber + 1)}>
                    Дальше
                  </Button>
                </nav>
              ) : null}
            </footer>
          </section>
        </>
      )}
    </>
  );
}
