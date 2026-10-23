// Who is in which room's voice right now, a row per room refreshed every few
// seconds, and the finished calls before: by day, a page at a time, or one
// day's timeline. Names, accounts, times and the kind of client only: nothing
// said in a room. An account opens its card; a room narrows the history to it.

import { ChartGantt, ChevronLeft, ChevronRight, List, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveRoom, RoomCall, RoomCallsQuery } from '@voice-room/shared/contracts/admin';
import { fetchLiveRooms, fetchRoomCalls } from '../api/admin.ts';
import { formatClock, formatCount, formatDuration, formatPeople, plural } from '../format.ts';
import { useRefreshStatus } from '../frame.tsx';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { Button, Empty, Panel, Pill, Segment } from '../ui/index.tsx';
import { CallList } from './rooms/CallList.tsx';
import { CallPeople } from './rooms/CallPeople.tsx';
import { DayTimeline } from './rooms/DayTimeline.tsx';
import { LiveCalls } from './rooms/LiveCalls.tsx';
import './RoomsPage.css';

const REFRESH_MS = 5000;
const DAY = 24 * 60 * 60 * 1000;
/** A day's timeline follows the pages up to this many; a busier day shows its latest calls. */
const TIMELINE_PAGES = 10;

export interface HistoryRoom {
  id: string;
  name: string | null;
}

type HistoryView = 'calls' | 'timeline';

const startOfToday = () => new Date().setHours(0, 0, 0, 0);

/** Adds or removes one value of a set, as a new set. */
function toggled(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** What the history asks for: a view, one room or all, and in the list a page. */
interface HistoryQuery {
  view: HistoryView;
  room: HistoryRoom | null;
  // The cursor each page opens with, the first one's empty; the API pages by
  // cursor, so a page already passed is only reached again through its own.
  cursors: (string | undefined)[];
  index: number;
}

/** What it answered, under the room it was asked for: the filter changes with its answer, so the chip never stands over another room's calls. */
type HistoryAnswer =
  | {
      view: 'calls';
      room: HistoryRoom | null;
      keepDays: number;
      calls: RoomCall[];
      cursors: (string | undefined)[];
      index: number;
    }
  | { view: 'timeline'; room: HistoryRoom | null; keepDays: number; calls: RoomCall[]; dayStart: number };

const firstPage = (view: HistoryView, room: HistoryRoom | null): HistoryQuery => ({
  view,
  room,
  cursors: [undefined],
  index: 0
});

async function fetchHistory({ view, room, cursors, index }: HistoryQuery): Promise<HistoryAnswer> {
  if (view === 'calls') {
    const after = index > 0 ? cursors[index] : undefined;
    const query: RoomCallsQuery = { ...(room ? { roomId: room.id } : {}), ...(after ? { after } : {}) };
    const page = await fetchRoomCalls(query);
    const next = [...cursors.slice(0, index + 1), ...(page.next ? [page.next] : [])];
    return { view, room, keepDays: page.keepDays, calls: page.calls, cursors: next, index };
  }
  // Every call of today, following the pages.
  const from = startOfToday();
  const span = { from: String(from), to: String(from + DAY), ...(room ? { roomId: room.id } : {}) };
  const calls: RoomCall[] = [];
  let after: string | null = null;
  let keepDays = 0;
  for (let page = 0; page < TIMELINE_PAGES; page += 1) {
    const answer = await fetchRoomCalls({ ...span, ...(after ? { after } : {}) });
    calls.push(...answer.calls);
    keepDays = answer.keepDays;
    after = answer.next;
    if (!after) break;
  }
  return { view, room, keepDays, calls, dayStart: from };
}

export function RoomsPage({
  onOpenAccount,
  focusRoom = null
}: {
  onOpenAccount: (accountId: string) => void;
  /** A room picked elsewhere (the search): the history narrows to it. */
  focusRoom?: HistoryRoom | null;
}) {
  // --- who is in voice now ---------------------------------------------------
  const live = useAdminResource(fetchLiveRooms, [], {
    failureText: 'Не удалось загрузить комнаты',
    refreshMs: REFRESH_MS
  });
  const rooms = live.data?.rooms ?? null;
  const [mountedAt] = useState(() => Date.now());
  const now = live.heardAt ?? mountedAt;
  const [openLive, setOpenLive] = useState<ReadonlySet<string>>(new Set());
  const liveSection = useRef<HTMLElement>(null);

  // --- the calls before --------------------------------------------------------
  const [historyQuery, setHistoryQuery] = useState<HistoryQuery>(() => firstPage('calls', null));
  // An answer for a room or page already left behind is dropped.
  const history = useAdminResource(() => fetchHistory(historyQuery), [historyQuery], {
    failureText: 'Не удалось загрузить историю'
  });
  const view = historyQuery.view;
  const shown = history.data;
  const historyRoom = shown?.room ?? null;
  const callsPage = shown?.view === 'calls' ? shown : null;
  const day = shown?.view === 'timeline' ? shown : null;
  const [openCalls, setOpenCalls] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const historySection = useRef<HTMLElement>(null);

  // A page asked for by the person: the pager waits for its answer.
  function showCallsPage(index: number): void {
    if (callsPage) setHistoryQuery({ view: 'calls', room: callsPage.room, cursors: callsPage.cursors, index });
  }

  /** Narrows the history (in the view on screen) to a room, or widens it to all. */
  function showRoomHistory(room: HistoryRoom | null, scroll = false): void {
    setPicked(null);
    setHistoryQuery(firstPage(view, room));
    if (scroll) historySection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function changeView(next: HistoryView): void {
    setPicked(null);
    setHistoryQuery(firstPage(next, historyRoom));
  }

  // The top bar's refresh asks for the rooms now and the history on screen again.
  const { reload: reloadLive } = live;
  const { reload: reloadHistory } = history;
  const reload = useCallback(() => {
    reloadLive();
    reloadHistory();
  }, [reloadLive, reloadHistory]);
  useRefreshStatus({ at: live.loadedAt, everyMs: REFRESH_MS, busy: live.busy, reload });

  // A room picked in the search narrows the history like any other narrowing: in the view
  // on screen, the pager waiting and the call picked before closed. Each pick is a new
  // object; its state and request reset while rendering, the scroll waits until it is on screen.
  const [seenFocusRoom, setSeenFocusRoom] = useState<HistoryRoom | null>(null);
  if (focusRoom !== seenFocusRoom) {
    setSeenFocusRoom(focusRoom);
    if (focusRoom) {
      setPicked(null);
      setHistoryQuery(firstPage(view, focusRoom));
    }
  }
  useEffect(() => {
    if (focusRoom) historySection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [focusRoom]);

  const peopleInVoice = (rooms ?? []).reduce((count, room) => count + room.peers.length, 0);
  const pageIndex = callsPage?.index ?? 0;
  const hasNextPage = callsPage ? callsPage.cursors.length > callsPage.index + 1 : false;
  const pickedCall = day?.calls.find((call) => call.id === picked) ?? null;
  const loadingHistory = (
    <Panel>
      <p className="ui-empty" aria-busy="true">
        Загружаем…
      </p>
    </Panel>
  );

  function openLiveRoom(room: LiveRoom): void {
    setOpenLive((open) => new Set(open).add(room.roomId));
    liveSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  return (
    <>
      <section className="rooms-section" aria-labelledby="rooms-live-title" ref={liveSection}>
        <header className="ui-section-head">
          <h2 id="rooms-live-title">Сейчас в звонках</h2>
          {rooms?.length ? (
            <Pill tone="success" dot>
              {`${formatCount(rooms.length)} ${plural(rooms.length, ['комната', 'комнаты', 'комнат'])} · ${formatPeople(peopleInVoice)}`}
            </Pill>
          ) : null}
          <span className="ui-section-note">обновляется каждые 5 с</span>
        </header>

        {live.failure && !rooms ? (
          <Notice failure={live.failure} onRetry={reloadLive} />
        ) : (
          <>
            {live.failure ? (
              <p className="admin-error" role="alert">
                {live.failure.message}
              </p>
            ) : null}
            <Panel flush>
              {!rooms ? (
                <p className="ui-empty" aria-busy="true">
                  Загружаем…
                </p>
              ) : rooms.length === 0 ? (
                <Empty>Сейчас никто не в звонке</Empty>
              ) : (
                <LiveCalls
                  rooms={rooms}
                  now={now}
                  open={openLive}
                  onToggle={(roomId) => setOpenLive((open) => toggled(open, roomId))}
                  onShowHistory={(room) => showRoomHistory({ id: room.roomId, name: room.name }, true)}
                  onOpenAccount={onOpenAccount}
                />
              )}
            </Panel>
          </>
        )}
      </section>

      <section className="rooms-section" aria-labelledby="rooms-history-title" ref={historySection}>
        <header className="ui-section-head">
          <h2 id="rooms-history-title">История звонков</h2>
          {historyRoom ? (
            <button type="button" className="rooms-filter" onClick={() => showRoomHistory(null)}>
              {historyRoom.name || historyRoom.id}
              <X size={13} aria-label="Показать все комнаты" />
            </button>
          ) : null}
          <span className="rooms-view">
            <Segment
              ariaLabel="Вид истории"
              value={view}
              onChange={changeView}
              options={[
                { value: 'calls', label: 'Звонки', icon: <List size={14} aria-hidden="true" /> },
                { value: 'timeline', label: 'Лента дня', icon: <ChartGantt size={14} aria-hidden="true" /> }
              ]}
            />
          </span>
        </header>

        {history.failure && !(view === 'calls' ? callsPage : day) ? (
          <Notice failure={history.failure} onRetry={() => showRoomHistory(historyRoom)} />
        ) : !shown ? (
          loadingHistory
        ) : (
          <>
            {history.failure ? (
              <p className="admin-error" role="alert">
                {history.failure.message}
              </p>
            ) : null}
            {view === 'calls' ? (
              // A view switched to waits for its own answer.
              !callsPage && history.busy ? (
                loadingHistory
              ) : !callsPage || callsPage.calls.length === 0 ? (
                <Panel>
                  <Empty>Завершённых звонков пока нет</Empty>
                </Panel>
              ) : (
                <>
                  <CallList
                    calls={callsPage.calls}
                    now={now}
                    open={openCalls}
                    onToggle={(callId) => setOpenCalls((open) => toggled(open, callId))}
                    onFilterRoom={(call) => showRoomHistory({ id: call.roomId, name: call.roomName || null })}
                    onOpenAccount={onOpenAccount}
                  />
                  {pageIndex > 0 || hasNextPage ? (
                    <nav className="rooms-pager" aria-label="Страницы истории">
                      <Button
                        variant="outline"
                        disabled={history.busy || pageIndex === 0}
                        onClick={() => showCallsPage(pageIndex - 1)}
                      >
                        <ChevronLeft size={14} aria-hidden="true" />
                        Назад
                      </Button>
                      <span className="rooms-quiet" aria-current="page">
                        Страница {pageIndex + 1}
                      </span>
                      <Button
                        variant="outline"
                        disabled={history.busy || !hasNextPage}
                        onClick={() => showCallsPage(pageIndex + 1)}
                      >
                        Дальше
                        <ChevronRight size={14} aria-hidden="true" />
                      </Button>
                    </nav>
                  ) : null}
                </>
              )
            ) : !day && history.busy ? (
              loadingHistory
            ) : (
              <>
                <Panel flush>
                  {!day || (day.calls.length === 0 && !(rooms ?? []).length) ? (
                    <Empty>Сегодня звонков не было</Empty>
                  ) : (
                    <DayTimeline
                      dayStart={day.dayStart}
                      now={now}
                      calls={day.calls}
                      live={
                        historyRoom ? (rooms ?? []).filter((room) => room.roomId === historyRoom.id) : (rooms ?? [])
                      }
                      selectedId={picked}
                      onSelect={(call) => setPicked(call.id === picked ? null : call.id)}
                      onOpenLive={openLiveRoom}
                    />
                  )}
                </Panel>
                {pickedCall ? (
                  <Panel
                    title={`${pickedCall.roomName || pickedCall.roomId} · ${formatClock(pickedCall.startedAt)}–${formatClock(pickedCall.endedAt)}`}
                    aside={formatDuration(pickedCall.endedAt - pickedCall.startedAt)}
                    flush
                  >
                    <div className="call-detail">
                      <CallPeople call={pickedCall} onOpenAccount={onOpenAccount} />
                    </div>
                  </Panel>
                ) : null}
              </>
            )}
          </>
        )}
        {shown?.keepDays ? (
          <p className="ui-footnote">
            Комната, имена гостей и откуда заходили хранятся {shown.keepDays} дней, потом у звонка остаётся только время
            для статистики.
          </p>
        ) : null}
      </section>
    </>
  );
}
