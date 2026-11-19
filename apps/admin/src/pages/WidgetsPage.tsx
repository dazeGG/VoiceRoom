// The calls websites made through the widget: today's numbers, whether rooms
// are taken from websites at all and the limits they run with (read only: an
// operator switches admission on the server), who is in a widget room's voice
// now, and the widget calls before, a page at a time. A participant's ip· or #
// narrows the history to that address or browser.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { AdminWidgets, RoomCall, WidgetRuntimeOwnerState } from '@voice-room/shared/contracts/admin';
import { fetchLiveRooms, fetchRoomCalls, fetchWidgets } from '../api/admin.ts';
import { formatCount, formatHours, formatPeople, plural } from '../format.ts';
import { useRefreshStatus } from '../frame.tsx';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useCan } from '../staff.tsx';
import type { CallRef } from '../tabs.ts';
import { Button, Empty, Panel, Pill, Stat, Stats } from '../ui/index.tsx';
import { Section, useSectionState } from '../ui/Section.tsx';
import { CallList } from './rooms/CallList.tsx';
import { FilterChips, type CallOriginFilters, type OriginPick } from './rooms/CallFilters.tsx';
import { LiveCalls } from './rooms/LiveCalls.tsx';
import './RoomsPage.css';
import './WidgetsPage.css';

const REFRESH_MS = 5000;
const SLOW_REFRESH_MS = 30_000;

/** A page of the history: the filters, and the cursor each page opens with (the first one's empty). */
interface HistoryQuery {
  filters: CallOriginFilters;
  cursors: (string | undefined)[];
  index: number;
}

interface HistoryAnswer extends HistoryQuery {
  keepDays: number;
  calls: RoomCall[];
}

async function fetchHistory({ filters, cursors, index }: HistoryQuery): Promise<HistoryAnswer> {
  const after = index > 0 ? cursors[index] : undefined;
  const page = await fetchRoomCalls({ ...filters, kind: 'widget', ...(after ? { after } : {}) });
  const next = [...cursors.slice(0, index + 1), ...(page.next ? [page.next] : [])];
  return { filters, cursors: next, index, keepDays: page.keepDays, calls: page.calls };
}

const firstPage = (filters: CallOriginFilters = {}): HistoryQuery => ({ filters, cursors: [undefined], index: 0 });

function toggled(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

const ROLE_NAMES: Record<WidgetRuntimeOwnerState['role'], string> = { api: 'API', gate: 'gate' };

/** Whether the processes serving widgets confirmed the current recovery generation. */
function ownersStatus(state: AdminWidgets['state']): { tone: 'success' | 'warning'; text: string } {
  const behind = state.owners.filter((owner) => owner.acknowledgedGeneration !== state.recoveryGeneration);
  if (behind.length === 0) return { tone: 'success', text: 'подтвердили' };
  return { tone: 'warning', text: `ждём: ${behind.map((owner) => ROLE_NAMES[owner.role]).join(', ')}` };
}

function windowText(ms: number): string {
  if (ms === 60_000) return 'в минуту';
  if (ms % 60_000 === 0) return `за ${formatCount(ms / 60_000)} мин`;
  return `за ${formatCount(Math.round(ms / 1000))} с`;
}

function StatePanel({ widgets }: { widgets: AdminWidgets }) {
  const { state, limits } = widgets;
  const owners = ownersStatus(state);
  return (
    <Panel>
      <div className="widgets-state">
        <dl className="widgets-kv">
          <div className="widgets-kv-title">Приём</div>
          <div className="widgets-kv-row">
            <dt>Приём звонков с сайтов</dt>
            <dd>
              <Pill tone={state.admissionEnabled ? 'success' : 'neutral'} compact>
                {state.admissionEnabled ? 'включён' : 'выключен'}
              </Pill>
            </dd>
          </div>
          <div className="widgets-kv-row">
            <dt>Граница комнат виджета</dt>
            <dd>
              {state.boundaryRequired ? <span className="widgets-kv-sub">не снимается</span> : null}
              <Pill tone={state.boundaryRequired ? 'success' : 'neutral'} compact>
                {state.boundaryRequired ? 'включена' : 'не включалась'}
              </Pill>
            </dd>
          </div>
          <div className="widgets-kv-row">
            <dt>Флаг сервера</dt>
            <dd className="ui-mono">WIDGET_ENABLED={state.flagEnabled ? 'true' : 'false'}</dd>
          </div>
          <div className="widgets-kv-row">
            <dt>API и gate</dt>
            <dd>
              <span className="widgets-kv-sub">поколение {formatCount(state.recoveryGeneration)}</span>
              <Pill tone={owners.tone} compact>
                {owners.text}
              </Pill>
            </dd>
          </div>
        </dl>
        <dl className="widgets-kv">
          <div className="widgets-kv-title">Лимиты из конфига</div>
          <div className="widgets-kv-row">
            <dt>Мест в комнате</dt>
            <dd>
              <span className="widgets-kv-sub">MAX_ROOM_PEERS</span>
              {formatCount(limits.maxRoomPeers)}
            </dd>
          </div>
          <div className="widgets-kv-row">
            <dt>Новых комнат с одного IP</dt>
            <dd>
              <span className="widgets-kv-sub">ROOM_CREATE_RATE_LIMIT</span>
              {`${formatCount(limits.createRateLimit)} ${windowText(limits.createRateWindowMs)}`}
            </dd>
          </div>
          <div className="widgets-kv-row">
            <dt>Проверка от ботов</dt>
            <dd>
              <span className="widgets-kv-sub">ROOM_CREATE_POW_DIFFICULTY</span>
              {`сложность ${formatCount(limits.powDifficulty)}`}
            </dd>
          </div>
          <div className="widgets-kv-row">
            <dt>Чат в комнате</dt>
            <dd>
              <span className="widgets-kv-sub">граница</span>
              выключен
            </dd>
          </div>
        </dl>
      </div>
      <p className="ui-footnote">
        Включение и выключение — <span className="ui-mono">scripts/cd/activate-widget.sh</span>, откат —{' '}
        <span className="ui-mono">widget-recovery.ts</span> на сервере.
      </p>
    </Panel>
  );
}

export function WidgetsPage({
  onOpenAccount,
  onOpenCall
}: {
  onOpenAccount: (accountId: string) => void;
  onOpenCall: (call: CallRef) => void;
}) {
  const canOrigin = useCan('origin.view');
  const widgets = useAdminResource(fetchWidgets, [], {
    failureText: 'Не удалось загрузить виджеты',
    refreshMs: SLOW_REFRESH_MS
  });
  const live = useAdminResource(fetchLiveRooms, [], {
    failureText: 'Не удалось загрузить комнаты',
    refreshMs: REFRESH_MS
  });
  const rooms = live.data ? live.data.rooms.filter((room) => room.kind === 'widget') : null;
  const [mountedAt] = useState(() => Date.now());
  const now = live.heardAt ?? mountedAt;
  const [openLive, setOpenLive] = useState<ReadonlySet<string>>(new Set());
  const [openCalls, setOpenCalls] = useState<ReadonlySet<string>>(new Set());

  const [historyQuery, setHistoryQuery] = useState<HistoryQuery>(() => firstPage());
  const history = useAdminResource(() => fetchHistory(historyQuery), [historyQuery], {
    failureText: 'Не удалось загрузить историю'
  });
  const shown = history.data;
  const historyFold = useSectionState('widgets', 'history');
  const historySection = useRef<HTMLElement>(null);

  function showFilters(filters: CallOriginFilters, scroll = false): void {
    setHistoryQuery(firstPage(filters));
    if (filters.ipKey || filters.clientId) {
      historyFold.setOpen(true);
      if (scroll) historySection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }
  const historyPick: OriginPick | undefined = canOrigin
    ? { filters: historyQuery.filters, onChange: (filters) => showFilters(filters) }
    : undefined;
  const livePick: OriginPick | undefined = canOrigin
    ? { filters: historyQuery.filters, onChange: (filters) => showFilters(filters, true) }
    : undefined;

  const { reload: reloadLive } = live;
  const { reload: reloadHistory } = history;
  const { reload: reloadWidgets } = widgets;
  const reload = useCallback(() => {
    reloadLive();
    reloadHistory();
    reloadWidgets();
  }, [reloadLive, reloadHistory, reloadWidgets]);
  useRefreshStatus({ at: live.loadedAt, everyMs: REFRESH_MS, busy: live.busy, reload });

  const today = widgets.data?.today ?? null;
  const people = (rooms ?? []).reduce((count, room) => count + room.peers.length, 0);
  const livePeers = (rooms ?? []).flatMap((room) => room.peers);
  const bad = livePeers.filter((peer) => peer.network === 'bad').length;
  const unstable = livePeers.filter((peer) => peer.network === 'unstable').length;
  const liveCount = rooms?.length ?? 0;
  const roomsText = (count: number) =>
    `${formatCount(count)} ${plural(count, ['комната', 'комнаты', 'комнат'])} виджета`;
  const pageIndex = shown?.index ?? 0;
  const hasNextPage = shown ? shown.cursors.length > shown.index + 1 : false;
  const loading = (
    <Panel>
      <p className="ui-empty" aria-busy="true">
        Загружаем…
      </p>
    </Panel>
  );

  return (
    <>
      <Stats label="Главное о виджетах" min={170}>
        <Stat
          label="В звонках"
          value={rooms ? formatPeople(people) : '…'}
          note={rooms ? roomsText(rooms.length) : undefined}
          dot="success"
        />
        <Stat
          label="Связь хуже нормы"
          value={rooms ? formatPeople(bad + unstable) : '…'}
          tone={bad ? 'danger' : unstable ? 'warning' : undefined}
          note={rooms ? `${formatCount(bad)} плохо · ${formatCount(unstable)} нестабильно` : undefined}
          dot={bad ? 'danger' : unstable ? 'warning' : undefined}
        />
        <Stat
          label="Звонков сегодня"
          value={today ? formatCount(today.calls + liveCount) : '…'}
          note={
            today
              ? `${formatCount(today.calls)} завершены · ${formatCount(liveCount)} ${plural(liveCount, ['идёт', 'идут', 'идут'])}`
              : undefined
          }
        />
        <Stat
          label="Гостей сегодня"
          value={today ? formatCount(today.guests) : '…'}
          note={
            today
              ? `с ${formatCount(today.distinctIpKeys)} ${plural(today.distinctIpKeys, ['разного', 'разных', 'разных'])} IP`
              : undefined
          }
        />
        <Stat
          label="Часов в войсе сегодня"
          value={today ? formatHours(today.voiceMinutes / 60) : '…'}
          note="минуты всех участников"
        />
      </Stats>

      <Section
        page="widgets"
        id="state"
        title="Состояние"
        summary={
          widgets.data ? (
            <Pill tone={widgets.data.state.admissionEnabled ? 'success' : 'neutral'} dot>
              {widgets.data.state.admissionEnabled ? 'приём включён' : 'приём выключен'}
            </Pill>
          ) : null
        }
        link="меняется только командой оператора"
      >
        {widgets.failure && !widgets.data ? (
          <Notice failure={widgets.failure} onRetry={reloadWidgets} />
        ) : widgets.data ? (
          <StatePanel widgets={widgets.data} />
        ) : (
          loading
        )}
      </Section>

      <Section
        page="widgets"
        id="live"
        title="Сейчас в звонках"
        summary={
          rooms?.length ? (
            <Pill tone="success" dot>
              {`${formatPeople(people)} в ${formatCount(rooms.length)} ${plural(rooms.length, ['комнате', 'комнатах', 'комнатах'])}`}
            </Pill>
          ) : null
        }
        link="обновляется каждые 5 с"
      >
        {live.failure && !rooms ? (
          <Notice failure={live.failure} onRetry={reloadLive} />
        ) : (
          <Panel flush>
            {!rooms ? (
              <p className="ui-empty" aria-busy="true">
                Загружаем…
              </p>
            ) : rooms.length === 0 ? (
              <Empty>Сейчас никто не в звонке из виджета</Empty>
            ) : (
              <LiveCalls
                rooms={rooms}
                now={now}
                open={openLive}
                onToggle={(roomId) => setOpenLive((open) => toggled(open, roomId))}
                onOpenCall={(room) => onOpenCall({ kind: 'live', roomId: room.roomId })}
                onOpenAccount={onOpenAccount}
                pick={livePick}
                showOwner={false}
                label="Сейчас в звонках из виджетов"
              />
            )}
          </Panel>
        )}
      </Section>

      <Section
        page="widgets"
        id="history"
        title="История звонков"
        state={historyFold}
        sectionRef={historySection}
        summary={
          canOrigin && shown ? (
            <FilterChips filters={shown.filters} onChange={(filters) => showFilters(filters)} />
          ) : null
        }
      >
        {history.failure && !shown ? (
          <Notice failure={history.failure} onRetry={reloadHistory} />
        ) : !shown ? (
          loading
        ) : (
          <>
            {history.failure ? (
              <p className="admin-error" role="alert">
                {history.failure.message}
              </p>
            ) : null}
            {shown.calls.length === 0 ? (
              <Panel>
                <Empty>
                  {shown.filters.ipKey || shown.filters.clientId
                    ? 'С этим участником звонков из виджетов не было'
                    : 'Звонков из виджетов пока не было'}
                </Empty>
              </Panel>
            ) : (
              <CallList
                calls={shown.calls}
                now={now}
                open={openCalls}
                onToggle={(callId) => setOpenCalls((open) => toggled(open, callId))}
                onOpen={(call) => onOpenCall({ kind: 'finished', callId: call.id })}
                onOpenAccount={onOpenAccount}
                pick={historyPick}
              />
            )}
            {pageIndex > 0 || hasNextPage ? (
              <nav className="rooms-pager" aria-label="Страницы истории">
                <Button
                  variant="outline"
                  disabled={history.busy || pageIndex === 0}
                  onClick={() =>
                    setHistoryQuery({ filters: shown.filters, cursors: shown.cursors, index: pageIndex - 1 })
                  }
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
                  onClick={() =>
                    setHistoryQuery({ filters: shown.filters, cursors: shown.cursors, index: pageIndex + 1 })
                  }
                >
                  Дальше
                  <ChevronRight size={14} aria-hidden="true" />
                </Button>
              </nav>
            ) : null}
          </>
        )}
        {shown?.keepDays ? (
          <p className="ui-footnote">
            Имена гостей и откуда заходили хранятся {shown.keepDays} дней, потом у звонка остаётся только время для
            статистики.
          </p>
        ) : null}
      </Section>
    </>
  );
}
