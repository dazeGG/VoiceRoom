// The persistent rooms with their numbers of the last 30 days: found by name,
// code or owner, narrowed by what is going on in them, a page at a time. A
// room's clock narrows the call history below to it.

import { History, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  StaticRoomRow,
  StaticRooms as StaticRoomsPage,
  StaticRoomsFilter,
  StaticRoomsSort
} from '@voice-room/shared/contracts/admin';
import { formatAgo, formatCount, formatMinutes, formatNumericDate } from '../../format.ts';
import type { LoadFailure } from '../../load-state.ts';
import { Notice } from '../../Notice.tsx';
import { Button, Empty, Panel, Pill, RoomAvatar, Segment, Select } from '../../ui/index.tsx';
import { QualityCell } from './QualityBar.tsx';

const COLUMNS =
  'minmax(220px, 1.5fr) minmax(120px, 0.8fr) 92px 92px 100px minmax(130px, 0.9fr) minmax(180px, 1.1fr) 96px 36px';
const SEARCH_DELAY_MS = 250;

const FILTERS: readonly { value: StaticRoomsFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные за неделю' },
  { value: 'trouble', label: 'Со связью хуже нормы' },
  { value: 'quiet', label: 'Пустуют 30+ дней' }
];

const SORTS: readonly { value: StaticRoomsSort; label: string }[] = [
  { value: 'lastCall', label: 'По последнему звонку' },
  { value: 'voice', label: 'По часам в войсе' },
  { value: 'members', label: 'По участникам' },
  { value: 'quality', label: 'По качеству связи' },
  { value: 'created', label: 'По дате создания' }
];

export interface StaticRoomsView {
  q: string;
  filter: StaticRoomsFilter;
  sort: StaticRoomsSort;
  page: number;
}

export const FIRST_STATIC_VIEW: StaticRoomsView = { q: '', filter: 'all', sort: 'lastCall', page: 1 };

/** Nobody in it and no call for 30 days: the same line the filter draws. */
function isQuiet(room: StaticRoomRow, now: number): boolean {
  return !room.live && (room.lastCallAt === null || now - room.lastCallAt >= 30 * 24 * 60 * 60_000);
}

export function StaticRooms({
  page,
  failure,
  busy,
  view,
  now,
  onChange,
  onRetry,
  onShowHistory
}: {
  page: StaticRoomsPage | null;
  failure: LoadFailure | null;
  busy: boolean;
  view: StaticRoomsView;
  now: number;
  onChange: (view: StaticRoomsView) => void;
  onRetry: () => void;
  onShowHistory: (room: StaticRoomRow) => void;
}) {
  const [typed, setTyped] = useState(view.q);

  // The search goes to the server a moment after the last key.
  useEffect(() => {
    const q = typed.trim();
    if (q === view.q) return;
    const timer = window.setTimeout(() => onChange({ ...view, q, page: 1 }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [typed, view, onChange]);

  const lastPage = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  const shownFrom = page && page.total ? (page.page - 1) * page.pageSize + 1 : 0;
  const shownTo = page ? Math.min(page.total, page.page * page.pageSize) : 0;

  return (
    <>
      <div className="ui-toolbar">
        <label className="static-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            placeholder="Название, код или владелец"
            aria-label="Поиск комнаты"
            maxLength={100}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <Segment
          ariaLabel="Показать комнаты"
          value={view.filter}
          onChange={(filter) => onChange({ ...view, filter, page: 1 })}
          options={FILTERS.map((filter) => ({
            ...filter,
            ...(page
              ? {
                  suffix: (
                    <>
                      {' '}
                      <span className="static-count ui-num">{formatCount(page.counts[filter.value])}</span>
                    </>
                  )
                }
              : {})
          }))}
        />
        <label className="static-sort">
          Сортировка
          <Select
            value={view.sort}
            onChange={(event) => {
              const sort = SORTS.find((option) => option.value === event.target.value)?.value;
              if (sort) onChange({ ...view, sort, page: 1 });
            }}
          >
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {failure && !page ? (
        <Notice failure={failure} onRetry={onRetry} />
      ) : (
        <>
          {failure ? (
            <p className="admin-error" role="alert">
              {failure.message}
            </p>
          ) : null}
          <Panel flush>
            {!page ? (
              <p className="ui-empty" aria-busy="true">
                Загружаем…
              </p>
            ) : page.rooms.length === 0 ? (
              <Empty>Таких комнат нет</Empty>
            ) : (
              <div className="ui-table-scroll">
                <div
                  className="ui-table"
                  role="table"
                  aria-label="Постоянные комнаты"
                  style={{ '--table-min': '1040px' }}
                >
                  <div className="ui-tr ui-thead" role="row" style={{ '--cols': COLUMNS }}>
                    <span role="columnheader">Комната</span>
                    <span role="columnheader">Владелец</span>
                    <span role="columnheader" className="ui-cell-end">
                      Участников
                    </span>
                    <span role="columnheader" className="ui-cell-end">
                      Звонков
                    </span>
                    <span role="columnheader" className="ui-cell-end">
                      В войсе
                    </span>
                    <span role="columnheader">Последний звонок</span>
                    <span role="columnheader">Связь в звонках</span>
                    <span role="columnheader">Создана</span>
                    <span role="columnheader" aria-label="История" />
                  </div>
                  {page.rooms.map((room) => (
                    <div key={room.id} className="ui-tr static-row" role="row" style={{ '--cols': COLUMNS }}>
                      <span role="cell" className="static-room">
                        <RoomAvatar roomId={room.id} name={room.name} src={room.avatarUrl} />
                        <span className="static-room-text">
                          <span className="static-room-name">{room.name}</span>
                          <span className="static-room-code ui-mono">{room.id}</span>
                        </span>
                        {room.live ? (
                          <Pill tone="success" dot compact>
                            в звонке
                          </Pill>
                        ) : isQuiet(room, now) ? (
                          <Pill compact>пустует</Pill>
                        ) : null}
                      </span>
                      <span role="cell" className="static-owner ui-mono">
                        {room.owner ? `@${room.owner.login}` : '—'}
                      </span>
                      <span role="cell" className="ui-cell-end ui-num">
                        {formatCount(room.members)}
                      </span>
                      <span role="cell" className="ui-cell-end ui-num">
                        {formatCount(room.calls30d)}
                      </span>
                      <span role="cell" className="ui-cell-end ui-num">
                        {formatMinutes(room.voiceMinutes30d)}
                      </span>
                      <span role="cell" className="static-last" data-live={room.live}>
                        {room.live ? 'сейчас' : room.lastCallAt === null ? '—' : formatAgo(room.lastCallAt, now)}
                      </span>
                      <span role="cell">
                        <QualityCell quality={room.quality30d} long none="нет звонков" />
                      </span>
                      <span role="cell" className="static-created ui-num">
                        {formatNumericDate(room.createdAt)}
                      </span>
                      <span role="cell">
                        <button
                          type="button"
                          className="live-history"
                          aria-label={`История звонков: ${room.name}`}
                          title="История звонков комнаты"
                          onClick={() => onShowHistory(room)}
                        >
                          <History size={16} aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {page && page.total > 0 ? (
              <footer className="static-foot">
                <span>
                  Показано {formatCount(shownFrom)}–{formatCount(shownTo)} из {formatCount(page.total)}
                  {busy ? ' · обновляем…' : ''}
                </span>
                {lastPage > 1 ? (
                  <nav className="static-pages" aria-label="Страницы комнат">
                    <Button
                      disabled={view.page <= 1 || busy}
                      onClick={() => onChange({ ...view, page: view.page - 1 })}
                    >
                      Назад
                    </Button>
                    <Button
                      disabled={view.page >= lastPage || busy}
                      onClick={() => onChange({ ...view, page: view.page + 1 })}
                    >
                      Дальше
                    </Button>
                  </nav>
                ) : null}
              </footer>
            ) : null}
          </Panel>
        </>
      )}
    </>
  );
}
