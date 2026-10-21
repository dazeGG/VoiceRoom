// Every account of the service: found by name or login, narrowed by a
// filter, sorted by any column, a page at a time. A row opens the account's
// card; the list keeps its search, filter and page meanwhile.

import { ArrowDown, ArrowUp, Globe, Monitor, Search, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AccountRow,
  AccountsFilter,
  AccountsPage as AccountsPageData,
  AccountsSort
} from '@voice-room/shared/contracts/admin';
import { ACCOUNT_FILTERS, SORT_COLUMNS, isAccountsFilter } from '../accounts.ts';
import { fetchAccounts } from '../api/admin.ts';
import { formatAgo, formatCount, formatDate, formatMinutes } from '../format.ts';
import { loadFailure, type LoadFailure } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { AccountBadge, Avatar, Button, Select } from '../ui/index.tsx';
import { AccountCard } from './AccountCard.tsx';
import './AccountsPage.css';

const SEARCH_DELAY_MS = 250;

const nameOf = (account: AccountRow) => account.displayName || account.login;

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
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState<AccountsPageData | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  // The request the list last heard back from; it is loading while that is not the current one.
  const [settled, setSettled] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const requestKey = [search, filter, sort, order, pageNumber, reload].join('|');
  const loading = settled !== requestKey;

  // The search goes to the server a moment after the last key.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(typed.trim());
      setPageNumber(1);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    // A slower answer for a query already left behind is dropped.
    let current = true;
    fetchAccounts({ filter, sort, order, page: String(pageNumber), ...(search ? { q: search } : {}) }).then(
      (loaded) => {
        if (!current) return;
        setPage(loaded);
        setFailure(null);
        setNow(Date.now());
        setSettled(requestKey);
      },
      (cause: unknown) => {
        if (!current) return;
        setFailure(loadFailure(cause, 'Не удалось загрузить аккаунты'));
        setSettled(requestKey);
      }
    );
    return () => {
      current = false;
    };
  }, [requestKey, search, filter, sort, order, pageNumber]);

  function changeFilter(value: string): void {
    if (!isAccountsFilter(value)) return;
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
    setReload((value) => value + 1);
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
      <div className="acc-toolbar">
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
        <div className="acc-filter">
          <Select value={filter} aria-label="Показать" onChange={(event) => changeFilter(event.target.value)}>
            {ACCOUNT_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        {page ? (
          <span className="acc-quiet">
            {page.total ? `${formatCount(shownFrom)}–${formatCount(shownTo)} из ${formatCount(page.total)}` : 'Никого'}
            {loading ? ' · обновляем…' : ''}
          </span>
        ) : null}
      </div>

      {failure && !page ? (
        <Notice failure={failure} onRetry={() => setReload((value) => value + 1)} />
      ) : !page ? (
        <p className="acc-quiet" aria-busy="true">
          Загружаем…
        </p>
      ) : accounts.length === 0 ? (
        <p className="acc-quiet">Под этот поиск никто не подходит.</p>
      ) : (
        <>
          {failure ? (
            <p className="acc-error" role="alert">
              {failure.message}
            </p>
          ) : null}
          <div className="acc-table-wrap">
            <table className="acc-table">
              <thead>
                <tr>
                  {SORT_COLUMNS.map((column) => (
                    <th
                      key={column.sort}
                      scope="col"
                      className={
                        column.sort !== 'name' && column.sort !== 'created' && column.sort !== 'lastSeen'
                          ? 'is-number'
                          : undefined
                      }
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
                            size={32}
                          />
                          {account.online ? <span className="acc-dot" aria-hidden="true" /> : null}
                        </span>
                        <span className="acc-person-text">
                          <span className="acc-person-name">
                            {nameOf(account)}
                            <AccountBadge userId={account.id} />
                          </span>
                          <span className="acc-person-login">@{account.login}</span>
                        </span>
                        {account.admin ? (
                          <span className="acc-chip" data-tone="accent">
                            сотрудник
                          </span>
                        ) : null}
                        {account.status === 'blocked' ? (
                          <span className="acc-chip" data-tone="danger">
                            заблокирован
                          </span>
                        ) : null}
                        {account.status === 'deleting' ? (
                          <span className="acc-chip" data-tone="danger">
                            удаляется
                          </span>
                        ) : null}
                      </button>
                    </td>
                    <td>{formatDate(account.createdAt)}</td>
                    <td>{account.online ? 'в сети' : formatAgo(account.lastSeenAt, now)}</td>
                    <td className="is-number">{formatCount(account.activeDays)}</td>
                    <td className="is-number">{formatMinutes(account.voiceMinutes)}</td>
                    <td className="is-number">{formatCount(account.messages)}</td>
                    <td className={account.reportsAgainst > 0 ? 'is-number has-reports' : 'is-number'}>
                      {account.reportsAgainst ? formatCount(account.reportsAgainst) : '—'}
                    </td>
                    <td>
                      <span className="acc-clients">
                        {account.clients.desktopApp ? (
                          <span title="Приложение" aria-label="Приложение">
                            <Monitor size={14} aria-hidden="true" />
                          </span>
                        ) : null}
                        {account.clients.browser ? (
                          <span title="Браузер" aria-label="Браузер">
                            <Globe size={14} aria-hidden="true" />
                          </span>
                        ) : null}
                        {account.clients.mobile ? (
                          <span title="Телефон" aria-label="Телефон">
                            <Smartphone size={14} aria-hidden="true" />
                          </span>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lastPage > 1 ? (
            <nav className="acc-pages" aria-label="Страницы">
              <Button disabled={pageNumber <= 1 || loading} onClick={() => setPageNumber(pageNumber - 1)}>
                Назад
              </Button>
              <span className="acc-quiet">
                Страница {pageNumber} из {lastPage}
              </span>
              <Button disabled={pageNumber >= lastPage || loading} onClick={() => setPageNumber(pageNumber + 1)}>
                Дальше
              </Button>
            </nav>
          ) : null}
          <p className="acc-quiet">
            «Откуда» — клиенты за последние 30 дней. Активные дни считаются с 15 октября 2026.
          </p>
        </>
      )}
    </>
  );
}
