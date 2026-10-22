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
import { loadFailure, type LoadFailure } from '../load-state.ts';
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

export function RoomsPage({
  onOpenAccount,
  focusRoom = null
}: {
  onOpenAccount: (accountId: string) => void;
  /** A room picked elsewhere (the search): the history narrows to it. */
  focusRoom?: HistoryRoom | null;
}) {
  // --- who is in voice now ---------------------------------------------------
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [liveFailure, setLiveFailure] = useState<LoadFailure | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [openLive, setOpenLive] = useState<ReadonlySet<string>>(new Set());
  const liveInFlight = useRef(false);
  const liveSection = useRef<HTMLElement>(null);

  // --- the calls before --------------------------------------------------------
  const [view, setView] = useState<HistoryView>('calls');
  const [historyRoom, setHistoryRoom] = useState<HistoryRoom | null>(null);
  const [calls, setCalls] = useState<RoomCall[]>([]);
  // The cursor each page opens with, the first one's empty; the API pages by
  // cursor, so a page already passed is only reached again through its own.
  const [pageCursors, setPageCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [keepDays, setKeepDays] = useState<number | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyFailure, setHistoryFailure] = useState<LoadFailure | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [openCalls, setOpenCalls] = useState<ReadonlySet<string>>(new Set());
  const [dayCalls, setDayCalls] = useState<RoomCall[] | null>(null);
  const [dayStart, setDayStart] = useState(startOfToday);
  const [picked, setPicked] = useState<string | null>(null);
  const historyRequest = useRef(0);
  const historySection = useRef<HTMLElement>(null);

  const loadLive = useCallback(() => {
    // A slow answer is waited for, not piled on: one request at a time keeps answers in order.
    if (liveInFlight.current) return;
    liveInFlight.current = true;
    setLiveBusy(true);
    fetchLiveRooms()
      .then(
        (loaded) => {
          setRooms(loaded.rooms);
          setLiveFailure(null);
          setLiveAt(Date.now());
        },
        (cause: unknown) => setLiveFailure(loadFailure(cause, 'Не удалось загрузить комнаты'))
      )
      .finally(() => {
        liveInFlight.current = false;
        setLiveBusy(false);
        setNow(Date.now());
      });
  }, []);

  /** One page of calls; an answer for a room or page already left behind is dropped. */
  const loadCalls = useCallback((room: HistoryRoom | null, cursors: (string | undefined)[], index: number) => {
    historyRequest.current += 1;
    const mine = historyRequest.current;
    const after = index > 0 ? cursors[index] : undefined;
    const query: RoomCallsQuery = { ...(room ? { roomId: room.id } : {}), ...(after ? { after } : {}) };
    fetchRoomCalls(query)
      .then(
        (page) => {
          if (mine !== historyRequest.current) return;
          // The filter changes with its answer, so the chip never stands over another room's calls.
          setHistoryRoom(room);
          setCalls(page.calls);
          setPageIndex(index);
          setPageCursors([...cursors.slice(0, index + 1), ...(page.next ? [page.next] : [])]);
          setKeepDays(page.keepDays);
          setHistoryLoaded(true);
          setHistoryFailure(null);
        },
        (cause: unknown) => {
          if (mine === historyRequest.current) setHistoryFailure(loadFailure(cause, 'Не удалось загрузить историю'));
        }
      )
      .finally(() => {
        if (mine === historyRequest.current) setHistoryLoading(false);
      });
  }, []);

  /** Every call of today, following the pages. */
  const loadDay = useCallback((room: HistoryRoom | null) => {
    historyRequest.current += 1;
    const mine = historyRequest.current;
    const from = startOfToday();
    const span = { from: String(from), to: String(from + DAY), ...(room ? { roomId: room.id } : {}) };
    const collect = async (): Promise<{ calls: RoomCall[]; keepDays: number }> => {
      const gathered: RoomCall[] = [];
      let after: string | null = null;
      let keep = 0;
      for (let page = 0; page < TIMELINE_PAGES; page += 1) {
        const answer = await fetchRoomCalls({ ...span, ...(after ? { after } : {}) });
        gathered.push(...answer.calls);
        keep = answer.keepDays;
        after = answer.next;
        if (!after) break;
      }
      return { calls: gathered, keepDays: keep };
    };
    collect()
      .then(
        (day) => {
          if (mine !== historyRequest.current) return;
          setHistoryRoom(room);
          setDayStart(from);
          setDayCalls(day.calls);
          setKeepDays(day.keepDays);
          setHistoryLoaded(true);
          setHistoryFailure(null);
        },
        (cause: unknown) => {
          if (mine === historyRequest.current) setHistoryFailure(loadFailure(cause, 'Не удалось загрузить историю'));
        }
      )
      .finally(() => {
        if (mine === historyRequest.current) setHistoryLoading(false);
      });
  }, []);

  // A page asked for by the person: the pager waits for its answer.
  function showCallsPage(room: HistoryRoom | null, cursors: (string | undefined)[], index: number): void {
    setHistoryLoading(true);
    loadCalls(room, cursors, index);
  }

  /** Narrows the history (in the view on screen) to a room, or widens it to all. */
  function showRoomHistory(room: HistoryRoom | null, scroll = false): void {
    setHistoryLoading(true);
    setPicked(null);
    if (view === 'timeline') loadDay(room);
    else loadCalls(room, [undefined], 0);
    if (scroll) historySection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function changeView(next: HistoryView): void {
    setView(next);
    setHistoryLoading(true);
    setPicked(null);
    if (next === 'timeline') loadDay(historyRoom);
    else loadCalls(historyRoom, [undefined], 0);
  }

  // The top bar's refresh asks for the rooms now and the history on screen again.
  const reload = useCallback(() => {
    loadLive();
    if (view === 'timeline') loadDay(historyRoom);
    else loadCalls(historyRoom, pageCursors, pageIndex);
  }, [loadLive, loadDay, loadCalls, view, historyRoom, pageCursors, pageIndex]);
  useRefreshStatus({ at: liveAt, everyMs: REFRESH_MS, busy: liveBusy, reload });

  useEffect(() => {
    loadLive();
    loadCalls(null, [undefined], 0);
    // A hidden tab does not ask; it catches up the moment it shows again.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadLive();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadLive, loadCalls]);

  // A room picked in the search narrows the history once it is on screen; each pick is a new object.
  useEffect(() => {
    if (!focusRoom) return;
    loadCalls(focusRoom, [undefined], 0);
    historySection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [focusRoom, loadCalls]);

  const peopleInVoice = (rooms ?? []).reduce((count, room) => count + room.peers.length, 0);
  const hasNextPage = pageCursors.length > pageIndex + 1;
  const pickedCall = dayCalls?.find((call) => call.id === picked) ?? null;

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

        {liveFailure && !rooms ? (
          <Notice failure={liveFailure} onRetry={loadLive} />
        ) : (
          <>
            {liveFailure ? (
              <p className="admin-error" role="alert">
                {liveFailure.message}
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

        {historyFailure && !historyLoaded ? (
          <Notice failure={historyFailure} onRetry={() => showRoomHistory(historyRoom)} />
        ) : !historyLoaded ? (
          <Panel>
            <p className="ui-empty" aria-busy="true">
              Загружаем…
            </p>
          </Panel>
        ) : (
          <>
            {historyFailure ? (
              <p className="admin-error" role="alert">
                {historyFailure.message}
              </p>
            ) : null}
            {view === 'calls' ? (
              calls.length === 0 ? (
                <Panel>
                  <Empty>Завершённых звонков пока нет</Empty>
                </Panel>
              ) : (
                <>
                  <CallList
                    calls={calls}
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
                        disabled={historyLoading || pageIndex === 0}
                        onClick={() => showCallsPage(historyRoom, pageCursors, pageIndex - 1)}
                      >
                        <ChevronLeft size={14} aria-hidden="true" />
                        Назад
                      </Button>
                      <span className="rooms-quiet" aria-current="page">
                        Страница {pageIndex + 1}
                      </span>
                      <Button
                        variant="outline"
                        disabled={historyLoading || !hasNextPage}
                        onClick={() => showCallsPage(historyRoom, pageCursors, pageIndex + 1)}
                      >
                        Дальше
                        <ChevronRight size={14} aria-hidden="true" />
                      </Button>
                    </nav>
                  ) : null}
                </>
              )
            ) : (
              <>
                <Panel flush>
                  {(dayCalls ?? []).length === 0 && !(rooms ?? []).length ? (
                    <Empty>Сегодня звонков не было</Empty>
                  ) : (
                    <DayTimeline
                      dayStart={dayStart}
                      now={now}
                      calls={dayCalls ?? []}
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
        {keepDays ? (
          <p className="ui-footnote">
            Комната, имена гостей и откуда заходили хранятся {keepDays} дней, потом у звонка остаётся только время для
            статистики.
          </p>
        ) : null}
      </section>
    </>
  );
}
