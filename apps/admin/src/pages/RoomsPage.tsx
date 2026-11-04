// Who is in which room's voice right now, a row per room refreshed every few
// seconds, the persistent rooms with their last 30 days, and the finished calls
// before: by day, a page at a time, or the timeline of a day picked on the
// calendar. Names, accounts, times and the kind of client only: nothing said in
// a room. An account opens its card; a room narrows the history to it; a call
// opens its page.

import { ArrowUpRight, ChartGantt, ChevronLeft, ChevronRight, List, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VOICE_HISTORY_KEEP_DAYS,
  type LiveRoom,
  type RoomCall,
  type RoomCallsQuery
} from '@voice-room/shared/contracts/admin';
import { fetchLiveRooms, fetchOverview, fetchRoomCalls, fetchStaticRooms } from '../api/admin.ts';
import { formatClock, formatCount, formatDuration, formatHours, formatPeople, plural } from '../format.ts';
import { useRefreshStatus } from '../frame.tsx';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useCan } from '../staff.tsx';
import type { CallRef } from '../tabs.ts';
import { Button, Empty, Panel, Pill, Segment, Stat, Stats } from '../ui/index.tsx';
import { Section, useSectionState } from '../ui/Section.tsx';
import { CallList } from './rooms/CallList.tsx';
import { CallPeople } from './rooms/CallPeople.tsx';
import { DayPicker, shiftDay, startOfDay } from './rooms/DayPicker.tsx';
import { DayTimeline } from './rooms/DayTimeline.tsx';
import { LiveCalls } from './rooms/LiveCalls.tsx';
import { FIRST_STATIC_VIEW, StaticRooms, type StaticRoomsView } from './rooms/StaticRooms.tsx';
import './RoomsPage.css';

const REFRESH_MS = 5000;
const SLOW_REFRESH_MS = 30_000;
/** A day's timeline follows the pages up to this many; a busier day shows its latest calls. */
const TIMELINE_PAGES = 10;

export interface HistoryRoom {
  id: string;
  name: string | null;
}

type HistoryView = 'calls' | 'timeline';

const startOfToday = () => startOfDay(Date.now());

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
  /** The midnight of the day the timeline shows. */
  dayStart: number;
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

const firstPage = (view: HistoryView, room: HistoryRoom | null, dayStart = startOfToday()): HistoryQuery => ({
  view,
  room,
  cursors: [undefined],
  index: 0,
  dayStart
});

async function fetchHistory({ view, room, cursors, index, dayStart }: HistoryQuery): Promise<HistoryAnswer> {
  if (view === 'calls') {
    const after = index > 0 ? cursors[index] : undefined;
    const query: RoomCallsQuery = { ...(room ? { roomId: room.id } : {}), ...(after ? { after } : {}) };
    const page = await fetchRoomCalls(query);
    const next = [...cursors.slice(0, index + 1), ...(page.next ? [page.next] : [])];
    return { view, room, keepDays: page.keepDays, calls: page.calls, cursors: next, index };
  }
  // Every call of the day, following the pages.
  const from = dayStart;
  const span = { from: String(from), to: String(shiftDay(from, 1)), ...(room ? { roomId: room.id } : {}) };
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
  onOpenCall,
  focusRoom = null,
  focusLive = null,
  onLiveFocused
}: {
  onOpenAccount: (accountId: string) => void;
  onOpenCall: (call: CallRef) => void;
  /** A room picked elsewhere (the search): the history narrows to it. */
  focusRoom?: HistoryRoom | null;
  /** A call picked elsewhere (the overview): its row opens. */
  focusLive?: { roomId: string } | null;
  /** That pick is done with: coming back here later does not open the row again. */
  onLiveFocused?: () => void;
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
  const liveFold = useSectionState('rooms', 'live');
  const historyFold = useSectionState('rooms', 'history');
  const staticFold = useSectionState('rooms', 'static');

  // A call picked elsewhere opens its row, once for each pick.
  const [seenFocusLive, setSeenFocusLive] = useState<{ roomId: string } | null>(null);
  if (focusLive !== seenFocusLive) {
    setSeenFocusLive(focusLive);
    if (focusLive) setOpenLive((open) => new Set(open).add(focusLive.roomId));
  }

  // --- the persistent rooms ---------------------------------------------------
  const [staticView, setStaticView] = useState<StaticRoomsView>(FIRST_STATIC_VIEW);
  const staticRooms = useAdminResource(
    () =>
      fetchStaticRooms({
        filter: staticView.filter,
        sort: staticView.sort,
        page: String(staticView.page),
        ...(staticView.q ? { q: staticView.q } : {})
      }),
    [staticView],
    {
      failureText: 'Не удалось загрузить постоянные комнаты',
      ...(staticFold.open ? { refreshMs: SLOW_REFRESH_MS } : {})
    }
  );
  const staticCounts = staticRooms.data?.counts ?? null;

  // --- today's numbers, for those who may read them --------------------------
  const canStats = useCan('stats.view');
  const today = useAdminResource(() => (canStats ? fetchOverview() : Promise.resolve(null)), [canStats], {
    failureText: 'Не удалось загрузить обзор',
    refreshMs: SLOW_REFRESH_MS
  }).data?.today;

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
    if (callsPage) {
      setHistoryQuery({
        view: 'calls',
        room: callsPage.room,
        cursors: callsPage.cursors,
        index,
        dayStart: historyQuery.dayStart
      });
    }
  }

  /** Narrows the history (in the view on screen) to a room, or widens it to all. */
  function showRoomHistory(room: HistoryRoom | null, scroll = false): void {
    setPicked(null);
    setHistoryQuery(firstPage(view, room, historyQuery.dayStart));
    if (room) historyFold.setOpen(true);
    if (scroll) historySection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function changeView(next: HistoryView): void {
    setPicked(null);
    setHistoryQuery(firstPage(next, historyRoom, historyQuery.dayStart));
  }

  function showDay(dayStart: number): void {
    setPicked(null);
    setHistoryQuery(firstPage('timeline', historyRoom, dayStart));
  }

  // The top bar's refresh asks for the rooms now and the history on screen again.
  const { reload: reloadLive } = live;
  const { reload: reloadHistory } = history;
  const { reload: reloadStatic } = staticRooms;
  const reload = useCallback(() => {
    reloadLive();
    reloadHistory();
    reloadStatic();
  }, [reloadLive, reloadHistory, reloadStatic]);
  useRefreshStatus({ at: live.loadedAt, everyMs: REFRESH_MS, busy: live.busy, reload });

  // A room picked in the search narrows the history like any other narrowing: in the view
  // on screen, the pager waiting and the call picked before closed. Each pick is a new
  // object; its state and request reset while rendering, the scroll waits until it is on screen.
  const [seenFocusRoom, setSeenFocusRoom] = useState<HistoryRoom | null>(null);
  if (focusRoom !== seenFocusRoom) {
    setSeenFocusRoom(focusRoom);
    if (focusRoom) {
      setPicked(null);
      setHistoryQuery(firstPage(view, focusRoom, historyQuery.dayStart));
    }
  }
  const { setOpen: openHistoryFold } = historyFold;
  const { setOpen: openLiveFold } = liveFold;
  useEffect(() => {
    if (!focusRoom) return;
    openHistoryFold(true);
    historySection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [focusRoom, openHistoryFold]);
  useEffect(() => {
    if (!focusLive) return;
    openLiveFold(true);
    onLiveFocused?.();
  }, [focusLive, openLiveFold, onLiveFocused]);

  const peopleInVoice = (rooms ?? []).reduce((count, room) => count + room.peers.length, 0);
  const livePeers = (rooms ?? []).flatMap((room) => room.peers);
  const badPeers = livePeers.filter((peer) => peer.network === 'bad').length;
  const unstablePeers = livePeers.filter((peer) => peer.network === 'unstable').length;
  const liveSummary = rooms?.length
    ? `${formatCount(rooms.length)} ${plural(rooms.length, ['комната', 'комнаты', 'комнат'])} · ${formatPeople(peopleInVoice)}`
    : null;
  const pageIndex = callsPage?.index ?? 0;
  const hasNextPage = callsPage ? callsPage.cursors.length > callsPage.index + 1 : false;
  const pickedCall = day?.calls.find((call) => call.id === picked) ?? null;
  const dayIsToday = day ? day.dayStart === startOfDay(now) : true;
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
      <Stats label="Главное о комнатах" min={170}>
        <Stat
          label="В звонках"
          value={rooms ? formatPeople(peopleInVoice) : '…'}
          note={
            rooms ? `${formatCount(rooms.length)} ${plural(rooms.length, ['комната', 'комнаты', 'комнат'])}` : undefined
          }
          dot="success"
        />
        <Stat
          label="Связь хуже нормы"
          value={rooms ? formatPeople(badPeers + unstablePeers) : '…'}
          tone={badPeers ? 'danger' : unstablePeers ? 'warning' : undefined}
          note={rooms ? `${formatCount(badPeers)} плохо · ${formatCount(unstablePeers)} нестабильно` : undefined}
          dot={badPeers ? 'danger' : unstablePeers ? 'warning' : undefined}
        />
        <Stat
          label="Постоянных комнат"
          value={staticCounts ? formatCount(staticCounts.all) : '…'}
          note={staticCounts ? `${formatCount(staticCounts.active)} активных за неделю` : undefined}
        />
        {today?.calls !== undefined ? (
          <Stat
            label="Звонков сегодня"
            value={formatCount(today.calls + (rooms?.length ?? 0))}
            note={`${formatCount(today.calls)} завершены · ${formatCount(rooms?.length ?? 0)} идут`}
          />
        ) : null}
        {today ? (
          <Stat
            label="Часов в войсе сегодня"
            value={formatHours(today.voiceMinutes / 60)}
            note="минуты всех участников"
          />
        ) : null}
      </Stats>

      <Section
        page="rooms"
        id="live"
        title="Сейчас в звонках"
        state={liveFold}
        sectionRef={liveSection}
        summary={
          liveSummary ? (
            <Pill tone="success" dot>
              {liveSummary}
            </Pill>
          ) : null
        }
        link="обновляется каждые 5 с"
      >
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
                  onOpenCall={(room) => onOpenCall({ kind: 'live', roomId: room.roomId })}
                  onOpenAccount={onOpenAccount}
                />
              )}
            </Panel>
          </>
        )}
      </Section>

      <Section
        page="rooms"
        id="static"
        title="Постоянные комнаты"
        state={staticFold}
        summary={staticCounts ? <Pill>{formatCount(staticCounts.all)}</Pill> : null}
        link="цифры за 30 дней"
      >
        <StaticRooms
          page={staticRooms.data}
          failure={staticRooms.failure}
          busy={staticRooms.busy}
          view={staticView}
          now={staticRooms.heardAt ?? now}
          onChange={setStaticView}
          onRetry={reloadStatic}
          onShowHistory={(room) => showRoomHistory({ id: room.id, name: room.name }, true)}
        />
      </Section>

      <Section
        page="rooms"
        id="history"
        title="История звонков"
        state={historyFold}
        sectionRef={historySection}
        summary={
          <>
            {historyRoom ? (
              <button type="button" className="rooms-filter" onClick={() => showRoomHistory(null)}>
                {historyRoom.name || historyRoom.id}
                <X size={13} aria-label="Показать все комнаты" />
              </button>
            ) : null}
            {today?.calls !== undefined && today.callsYesterday !== undefined ? (
              <span className="ui-toolbar-note">
                {`сегодня ${formatCount(today.calls)} · вчера ${formatCount(today.callsYesterday)}`}
              </span>
            ) : null}
          </>
        }
        link={
          <>
            {view === 'timeline' ? (
              <DayPicker
                dayStart={historyQuery.dayStart}
                today={startOfDay(now)}
                keepDays={shown?.keepDays || VOICE_HISTORY_KEEP_DAYS}
                onChange={showDay}
              />
            ) : null}
            <Segment
              ariaLabel="Вид истории"
              value={view}
              onChange={changeView}
              options={[
                { value: 'calls', label: 'Звонки', icon: <List size={14} aria-hidden="true" /> },
                { value: 'timeline', label: 'Лента дня', icon: <ChartGantt size={14} aria-hidden="true" /> }
              ]}
            />
          </>
        }
      >
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
                    onOpen={(call) => onOpenCall({ kind: 'finished', callId: call.id })}
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
                  {!day || (day.calls.length === 0 && !(dayIsToday && (rooms ?? []).length)) ? (
                    <Empty>{dayIsToday ? 'Сегодня звонков не было' : 'В этот день звонков не было'}</Empty>
                  ) : (
                    <DayTimeline
                      dayStart={day.dayStart}
                      now={now}
                      calls={day.calls}
                      live={
                        // The calls going on now belong to today's line only.
                        !dayIsToday
                          ? []
                          : historyRoom
                            ? (rooms ?? []).filter((room) => room.roomId === historyRoom.id)
                            : (rooms ?? [])
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
                    aside={
                      <span className="rooms-picked-aside">
                        {formatDuration(pickedCall.endedAt - pickedCall.startedAt)}
                        <Button variant="ghost" onClick={() => onOpenCall({ kind: 'finished', callId: pickedCall.id })}>
                          Подробно о звонке
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </Button>
                      </span>
                    }
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
      </Section>
    </>
  );
}
