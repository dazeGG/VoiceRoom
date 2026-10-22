// The top bar's search: accounts by name, login or id (the accounts list's own
// search on the server) and the rooms in voice now by name or id. Ctrl+K or
// ⌘K puts the cursor in it; the arrows walk the results and Enter opens the
// chosen one, the first by default.

import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AccountRow, LiveRoom } from '@voice-room/shared/contracts/admin';
import { fetchAccounts, fetchLiveRooms } from '../api/admin.ts';
import { useCan } from '../staff.tsx';
import { Avatar } from '../ui/index.tsx';

const SEARCH_DELAY_MS = 250;
const SHOWN = 5;

type Hit = { kind: 'account'; account: AccountRow } | { kind: 'room'; room: LiveRoom };

interface Found {
  query: string;
  accounts: AccountRow[];
  rooms: LiveRoom[];
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

function roomMatches(room: LiveRoom, query: string): boolean {
  const needle = query.toLowerCase();
  return room.name.toLowerCase().includes(needle) || room.roomId.toLowerCase().includes(needle);
}

export function GlobalSearch({
  onOpenAccount,
  onOpenRoom
}: {
  onOpenAccount: (accountId: string) => void;
  onOpenRoom: (room: { id: string; name: string | null }) => void;
}) {
  const canAccounts = useCan('accounts.view');
  const canRooms = useCan('rooms.view');
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const query = typed.trim();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!query) return;
    // An answer for a query already typed over is dropped.
    let current = true;
    const timer = window.setTimeout(() => {
      Promise.all([
        canAccounts ? fetchAccounts({ q: query, page: '1' }).then((page) => page.accounts) : [],
        canRooms ? fetchLiveRooms().then((live) => live.rooms.filter((room) => roomMatches(room, query))) : []
      ]).then(
        ([accounts, rooms]) => {
          if (!current) return;
          setFound({ query, accounts: accounts.slice(0, SHOWN), rooms: rooms.slice(0, SHOWN) });
          setActive(0);
        },
        () => {
          if (current) setFound({ query, accounts: [], rooms: [] });
        }
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, canAccounts, canRooms]);

  const fresh = found !== null && found.query === query;
  const hits: Hit[] = fresh
    ? [
        ...found.accounts.map((account): Hit => ({ kind: 'account', account })),
        ...found.rooms.map((room): Hit => ({ kind: 'room', room }))
      ]
    : [];
  const showList = open && query !== '';

  function choose(hit: Hit): void {
    setOpen(false);
    setTyped('');
    input.current?.blur();
    if (hit.kind === 'account') onOpenAccount(hit.account.id);
    else onOpenRoom({ id: hit.room.roomId, name: hit.room.name });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!hits.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[Math.min(active, hits.length - 1)];
      if (hit) choose(hit);
    }
  }

  const optionId = (index: number) => `${listId}-${String(index)}`;
  const renderHit = (hit: Hit, index: number) => (
    <li
      key={hit.kind === 'account' ? `a-${hit.account.id}` : `r-${hit.room.roomId}`}
      id={optionId(index)}
      role="option"
      aria-selected={index === active}
      className="search-hit"
      onMouseEnter={() => setActive(index)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => choose(hit)}
    >
      {hit.kind === 'account' ? (
        <>
          <Avatar
            name={hit.account.displayName || hit.account.login}
            src={hit.account.avatarUrl}
            colorKey={hit.account.avatarColorKey}
            background={hit.account.avatarAccent}
            size={26}
          />
          <span className="search-hit-name">{hit.account.displayName || hit.account.login}</span>
          <span className="search-hit-meta">@{hit.account.login}</span>
        </>
      ) : (
        <>
          <span className="search-hit-room" aria-hidden="true">
            #
          </span>
          <span className="search-hit-name">{hit.room.name || hit.room.roomId}</span>
          <span className="search-hit-meta search-hit-meta--plain">в звонке: {hit.room.peers.length}</span>
        </>
      )}
    </li>
  );

  const accountsShown = fresh ? found.accounts.length : 0;
  return (
    <div className="search" ref={root}>
      <label className="search-field">
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Поиск по аккаунтам и комнатам"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && hits.length ? optionId(active) : undefined}
          placeholder="Аккаунт, логин, комната или id"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <kbd className="search-key" aria-hidden="true">
          {isMac() ? '⌘K' : 'Ctrl K'}
        </kbd>
      </label>
      {showList ? (
        <div className="search-panel">
          {!fresh ? (
            <p className="search-quiet">Ищем…</p>
          ) : !hits.length ? (
            <p className="search-quiet">Ничего не найдено</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Найдено" className="search-list">
              {found.accounts.length ? (
                <li role="presentation" className="search-section">
                  Аккаунты
                </li>
              ) : null}
              {hits.slice(0, accountsShown).map(renderHit)}
              {found.rooms.length ? (
                <li role="presentation" className="search-section">
                  Комнаты в звонке
                </li>
              ) : null}
              {hits.slice(accountsShown).map((hit, index) => renderHit(hit, accountsShown + index))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
