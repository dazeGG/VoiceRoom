// The dashboard of the whole panel: what asks for attention, the numbers of
// right now and of today, the calls going on and those just over, voice hours,
// the server and the answers about calls. The calls refresh every few seconds,
// the rest every half minute.

import { ArrowDownRight, ArrowUpRight, Flag, ThumbsDown } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import type { AdminOverview, LiveRoom, ProductStats, RoomCall, SystemStats } from '@voice-room/shared/contracts/admin';
import { CALL_FEEDBACK_BAD_TAGS } from '@voice-room/shared/contracts/feedback';
import { CALL_FEEDBACK_TAG_LABELS } from '@voice-room/shared/feedback-labels';
import { REPORT_REASON_LABELS } from '@voice-room/shared/report-labels';
import { fetchLiveRooms, fetchOverview, fetchProductStats, fetchRoomCalls, fetchSystemStats } from '../api/admin.ts';
import { TimeChart } from '../charts/TimeChart.tsx';
import {
  formatBytes,
  formatClock,
  formatCount,
  formatDay,
  formatShortDay,
  formatDuration,
  formatHours,
  formatMs,
  formatPeople,
  formatPercent,
  formatSampleTime,
  formatSince,
  plural
} from '../format.ts';
import { useRefreshStatus } from '../frame.tsx';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useCan } from '../staff.tsx';
import type { AdminTab, CallRef } from '../tabs.ts';
import { PRODUCT_PRESETS, productQuery } from '../time-range.ts';
import { AvatarStack, Button, Empty, Pill, RoomAvatar, Segment, Stat, Stats } from '../ui/index.tsx';
import { Section, TextLink } from '../ui/Section.tsx';
import { troubleOf } from './rooms/LiveCalls.tsx';
import { QualityCell, qualityOfCall } from './rooms/QualityBar.tsx';
import { peopleOf } from './rooms/room-bits.tsx';
import { lossIn, lossOut } from './SystemPage.tsx';
import './OverviewPage.css';

const REFRESH_MS = 30_000;
const LIVE_REFRESH_MS = 5000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const RECENT_CALLS = 6;
const TOP_TAGS = 4;

type HoursPeriod = '7d' | '14d' | '30d';
const HOURS_PERIODS: readonly { value: HoursPeriod; label: string }[] = [
  { value: '7d', label: '7 дней' },
  { value: '14d', label: '14 дней' },
  { value: '30d', label: '30 дней' }
];

function percent(used: number | null, total: number | null): number | null {
  return used !== null && total ? (used / total) * 100 : null;
}

function level(value: number | null): 'unknown' | 'bad' | 'warn' | 'ok' {
  if (value === null) return 'unknown';
  return value >= 90 ? 'bad' : value >= 70 ? 'warn' : 'ok';
}

const wholePercent = (value: number) => `${Math.round(value)}%`;

function Delta({ current, previous, unit }: { current: number; previous: number; unit: string }) {
  const change = Math.round((current - previous) * 10) / 10;
  if (change === 0) return <span className="kpi-delta" data-direction="flat">{`без изменений ${unit}`}</span>;
  const Icon = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="kpi-delta" data-direction={change > 0 ? 'up' : 'down'}>
      <Icon size={14} aria-hidden="true" />
      {`${change > 0 ? '+' : ''}${change} ${unit}`}
    </span>
  );
}

/** The dashboard's three answers, asked for together so they describe the same moment. */
function loadDashboard(): Promise<[AdminOverview, ProductStats, SystemStats]> {
  const at = Date.now();
  return Promise.all([
    fetchOverview(),
    fetchProductStats(productQuery({ kind: 'preset', id: '14d' }, PRODUCT_PRESETS, at)),
    fetchSystemStats({ from: String(at - DAY), to: String(at) })
  ]);
}

function AttentionCard({
  label,
  mark,
  value,
  detail,
  danger = false,
  children
}: {
  label: string;
  mark: ReactNode;
  value: string;
  detail: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="attention-card" data-danger={danger}>
      <span className="attention-label">
        {mark}
        {label}
      </span>
      <span className="attention-value">{value}</span>
      {detail ? <span className="attention-detail">{detail}</span> : null}
      <span className="attention-action">{children}</span>
    </div>
  );
}

const roomName = (room: Pick<LiveRoom, 'roomId' | 'name'>) => room.name || room.roomId;

function Attention({
  overview,
  rooms,
  calls,
  canReview,
  now,
  onOpenReports,
  onOpenTab,
  onOpenAccount,
  onOpenCall
}: {
  overview: AdminOverview;
  rooms: readonly LiveRoom[] | null;
  calls: readonly RoomCall[] | null;
  canReview: boolean;
  now: number;
  onOpenReports: () => void;
  onOpenTab: (tab: AdminTab) => void;
  onOpenAccount: (accountId: string) => void;
  onOpenCall: (call: CallRef) => void;
}) {
  const reasons = (overview.reports?.reasons ?? []).map((reason) => REPORT_REASON_LABELS[reason].toLowerCase());
  const oldest = overview.reports?.oldestAt ?? null;
  const reportDetail = [oldest === null ? '' : `самая старая — ${formatSince(oldest, now)} назад`, reasons.join(', ')]
    .filter(Boolean)
    .join(' · ');

  const troubled = (rooms ?? []).flatMap((room) => {
    const trouble = troubleOf(room.peers);
    return trouble ? [{ room, count: trouble.count }] : [];
  });
  const troubledPeople = troubled.reduce((sum, { count }) => sum + count, 0);

  const overloaded = (rooms ?? []).flatMap((room) => room.peers).filter((peer) => peer.cpuPressure === 'critical');
  const overloadedAccount = overloaded.find((peer) => peer.account)?.account;

  const day = overview.feedback?.day;
  const badAnswers = day?.bad ?? 0;
  const badCall = calls?.find((call) => call.badFeedback);
  const dayTags = (day?.tags ?? [])
    .slice()
    .sort((a, b) => b.count - a.count)
    .filter(({ tag }) => isBadTag(tag))
    .slice(0, 2)
    .map(({ tag }) => tagLabel(tag).toLowerCase());

  const cards: ReactNode[] = [];
  if (canReview && overview.openReports > 0) {
    cards.push(
      <AttentionCard
        key="reports"
        danger
        label="Открытые жалобы"
        mark={<Flag size={15} aria-hidden="true" />}
        value={formatCount(overview.openReports)}
        detail={reportDetail}
      >
        <Button variant="danger" onClick={onOpenReports}>
          Разобрать
        </Button>
      </AttentionCard>
    );
  }
  if (troubledPeople > 0) {
    cards.push(
      <AttentionCard
        key="voice"
        label="Связь хуже нормы сейчас"
        mark={<span className="attention-dot" data-tone="danger" aria-hidden="true" />}
        value={formatPeople(troubledPeople)}
        detail={troubled.map(({ room, count }) => `${roomName(room)} — ${formatCount(count)}`).join(' · ')}
      >
        <TextLink onClick={() => onOpenTab('rooms')}>Открыть звонки</TextLink>
      </AttentionCard>
    );
  }
  if (overloaded.length > 0) {
    const relieved = overloaded.some((peer) => peer.relieved);
    cards.push(
      <AttentionCard
        key="cpu"
        label="Процессор клиента в critical"
        mark={<span className="attention-dot" data-tone="warning" aria-hidden="true" />}
        value={`${formatCount(overloaded.length)} ${plural(overloaded.length, ['клиент', 'клиента', 'клиентов'])}`}
        detail={[overloaded.map((peer) => peer.name).join(', '), relieved ? 'облегчённый шумодав включён' : '']
          .filter(Boolean)
          .join(' · ')}
      >
        <TextLink onClick={() => (overloadedAccount ? onOpenAccount(overloadedAccount.id) : onOpenTab('rooms'))}>
          Кто это
        </TextLink>
      </AttentionCard>
    );
  }
  if (badAnswers > 0 && day) {
    cards.push(
      <AttentionCard
        key="feedback"
        label="Плохие отзывы за сутки"
        mark={<span className="attention-dot" data-tone="warning" aria-hidden="true" />}
        value={`${formatCount(badAnswers)} из ${formatCount(day.good + day.bad)}`}
        detail={dayTags.join(' · ')}
      >
        {badCall ? (
          <TextLink onClick={() => onOpenCall({ kind: 'finished', callId: badCall.id })}>К звонку</TextLink>
        ) : (
          <TextLink onClick={() => onOpenTab('feedback')}>Все отзывы</TextLink>
        )}
      </AttentionCard>
    );
  }

  return (
    <Section
      page="overview"
      id="attention"
      title="Требует внимания"
      summary={
        cards.length ? (
          <Pill tone="danger" dot>
            {formatCount(cards.length)}
          </Pill>
        ) : null
      }
    >
      {cards.length ? <div className="attention">{cards}</div> : <p className="attention-calm">Всё спокойно</p>}
    </Section>
  );
}

function isBadTag(tag: string): boolean {
  return BAD_TAGS.has(tag);
}

const BAD_TAGS: ReadonlySet<string> = new Set(CALL_FEEDBACK_BAD_TAGS);

function tagLabel(tag: string): string {
  const labels: Record<string, string> = CALL_FEEDBACK_TAG_LABELS;
  return labels[tag] ?? tag;
}

function LiveList({
  rooms,
  failure,
  now,
  onOpen
}: {
  rooms: readonly LiveRoom[] | null;
  failure: ReactNode;
  now: number;
  onOpen: (room: LiveRoom) => void;
}) {
  if (!rooms)
    return (
      failure ?? (
        <p className="dash-card ui-empty" aria-busy="true">
          Загружаем…
        </p>
      )
    );
  if (rooms.length === 0) {
    return (
      <div className="dash-card">
        <Empty>Сейчас никто не в звонке</Empty>
      </div>
    );
  }
  return (
    <ul className="dash-list" aria-label="Сейчас в звонках">
      {rooms.map((room) => {
        const trouble = troubleOf(room.peers);
        return (
          <li key={room.roomId}>
            <button type="button" className="dash-row-button" onClick={() => onOpen(room)}>
              <span className="dash-room">
                <RoomAvatar roomId={room.roomId} name={room.name} src={room.avatarUrl} />
                <span className="dash-room-text">
                  <span className="dash-room-name">{roomName(room)}</span>
                  <span className="dash-room-note">
                    {room.isStatic ? 'постоянная' : 'временная'}
                    {room.since ? ` · идёт ${formatSince(room.since, now)}` : ''}
                  </span>
                </span>
              </span>
              <span className="dash-people">
                <AvatarStack
                  size={24}
                  max={4}
                  people={room.peers.map((peer) => ({
                    key: peer.peerId,
                    name: peer.name,
                    src: peer.account?.avatarUrl ?? null,
                    colorKey: peer.account?.avatarColorKey ?? peer.avatarColorKey,
                    background: peer.account?.avatarAccent ?? null
                  }))}
                />
                <span className="dash-people-count">{formatPeople(room.peers.length)}</span>
              </span>
              <span className="dash-trouble">
                {trouble ? (
                  <Pill tone={trouble.tone} dot compact>
                    {`${trouble.count} со связью`}
                  </Pill>
                ) : (
                  <span className="dash-quiet">связь в порядке</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function HoursChart({ stats, failure }: { stats: ProductStats | null; failure: ReactNode }) {
  if (!stats)
    return (
      failure ?? (
        <p className="dash-card ui-empty" aria-busy="true">
          Загружаем…
        </p>
      )
    );
  const days = stats.days;
  const total = days.reduce((sum, day) => sum + day.voiceAccountHours + day.voiceGuestHours, 0);
  return (
    <TimeChart
      title={`${formatHours(total)} за ${formatCount(days.length)} ${plural(days.length, ['день', 'дня', 'дней'])}`}
      kind="bar"
      height={170}
      labels={days.map((day) => formatDay(day.day))}
      series={[
        { name: 'Аккаунты', values: days.map((day) => day.voiceAccountHours), color: 'var(--vr-success)' },
        { name: 'Гости', values: days.map((day) => day.voiceGuestHours), color: 'var(--vr-warning)' }
      ]}
    />
  );
}

function RecentCalls({
  calls,
  failure,
  now,
  onOpen
}: {
  calls: readonly RoomCall[] | null;
  failure: ReactNode;
  now: number;
  onOpen: (call: RoomCall) => void;
}) {
  if (!calls)
    return (
      failure ?? (
        <p className="dash-card ui-empty" aria-busy="true">
          Загружаем…
        </p>
      )
    );
  if (calls.length === 0) {
    return (
      <div className="dash-card">
        <Empty>Завершённых звонков пока нет</Empty>
      </div>
    );
  }
  return (
    <ul className="dash-list" aria-label="Последние звонки">
      {calls.map((call) => (
        <li key={call.id}>
          <button type="button" className="dash-row-button" onClick={() => onOpen(call)}>
            <span className="dash-call-when">
              <span className="ui-mono">
                {formatClock(call.startedAt)}–{formatClock(call.endedAt)}
              </span>
              <span className="dash-room-note">
                {`${formatShortDay(call.startedAt, now)} · ${formatDuration(call.endedAt - call.startedAt)}`}
              </span>
            </span>
            <span className="dash-room dash-call-room">
              <RoomAvatar roomId={call.roomId} name={call.roomName} src={call.avatarUrl ?? null} size={28} />
              <span className="dash-room-name">{call.roomName || call.roomId}</span>
            </span>
            <span className="dash-people-count">{formatPeople(peopleOf(call).length)}</span>
            <span className="dash-call-quality">
              <QualityCell quality={qualityOfCall(call)} />
            </span>
            {call.badFeedback ? (
              <span className="dash-bad" title="Плохие отзывы об этом звонке">
                <ThumbsDown size={14} aria-label="Плохих отзывов" />
                {formatCount(call.badFeedback)}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Server({ overview, system, now }: { overview: AdminOverview; system: SystemStats; now: number }) {
  const latest = overview.system;
  if (!latest) return <p className="dash-card dash-quiet">Замеров ещё нет</p>;
  const gauges = [
    { label: 'Процессор', value: latest.cpuPct, detail: `нагрузка ${latest.load1.toFixed(2)}` },
    {
      label: 'Память',
      value: percent(latest.memUsedBytes, latest.memTotalBytes),
      detail: `${formatBytes(latest.memUsedBytes)} из ${formatBytes(latest.memTotalBytes)}`
    },
    {
      label: 'Диск',
      value: percent(latest.diskUsedBytes, latest.diskTotalBytes),
      detail: `${formatBytes(latest.diskUsedBytes)} из ${formatBytes(latest.diskTotalBytes)}`
    }
  ];
  const samples = system.samples;
  const last = samples.at(-1) ?? null;
  const lastHour = samples.filter((sample) => sample.at > now - HOUR);
  const errors = lastHour.reduce((sum, sample) => sum + sample.http5xx, 0);
  const lossWorst = last ? Math.max(lossIn(last) ?? -1, lossOut(last) ?? -1) : -1;
  return (
    <div className="dash-card dash-server">
      <p className="dash-quiet">
        {`Версия ${overview.version} · работает ${formatSince(overview.startedAt, now)} · замер ${formatSince(latest.at, now)} назад`}
      </p>
      <div className="gauges">
        {gauges.map((gauge) => (
          <div key={gauge.label} className="gauge" data-level={level(gauge.value)}>
            <span className="gauge-head">
              <span>{gauge.label}</span>
              <strong>{formatPercent(gauge.value)}</strong>
            </span>
            <span className="gauge-bar">
              <span style={{ width: `${Math.min(100, gauge.value ?? 0)}%` }} />
            </span>
            <span className="gauge-detail">{gauge.detail}</span>
          </div>
        ))}
      </div>
      <dl className="gauge-facts">
        <div>
          <dt>Потери на LiveKit</dt>
          <dd>{lossWorst < 0 ? '—' : formatPercent(lossWorst)}</dd>
        </div>
        <div>
          <dt>Задержка API</dt>
          <dd>{formatMs(last?.httpAvgMs ?? null)}</dd>
        </div>
        <div>
          <dt>Ошибки 5xx за час</dt>
          <dd>{formatCount(errors)}</dd>
        </div>
        <div>
          <dt>Экранов и камер</dt>
          <dd>{`${formatCount(last?.videoScreensMax ?? 0)} · ${formatCount(last?.videoCamerasMax ?? 0)}`}</dd>
        </div>
      </dl>
    </div>
  );
}

function FeedbackWeek({ overview }: { overview: AdminOverview }) {
  const week = overview.feedback?.week;
  const answers = (week?.good ?? 0) + (week?.bad ?? 0);
  if (!week || answers === 0) {
    return (
      <div className="dash-card">
        <Empty>За неделю отзывов не было</Empty>
      </div>
    );
  }
  const tags = week.tags
    .filter(({ tag }) => isBadTag(tag))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_TAGS);
  const most = tags[0]?.count ?? 1;
  return (
    <div className="dash-card">
      <div className="week-answers-share">
        <span className="dash-big">{`${Math.round((week.good / answers) * 100)} %`}</span>
        <span className="week-answers-counts">
          хороших · <span data-tone="good">{formatCount(week.good)}</span> хорошо,{' '}
          <span data-tone="bad">{formatCount(week.bad)}</span> плохо
        </span>
      </div>
      <span
        className="week-answers-bar"
        role="img"
        aria-label={`${formatCount(week.good)} хороших и ${formatCount(week.bad)} плохих отзывов`}
      >
        {week.good ? <span data-net="good" style={{ flexGrow: week.good }} /> : null}
        {week.bad ? <span data-net="bad" style={{ flexGrow: week.bad }} /> : null}
      </span>
      {tags.length ? (
        <div className="week-answers-tags">
          <span className="dash-quiet">Чаще всего в плохих</span>
          {tags.map(({ tag, count }) => (
            <div key={tag} className="week-answers-tag">
              <span className="week-answers-tag-name">{tagLabel(tag)}</span>
              <span className="gauge-bar">
                <span data-net="bad" style={{ width: `${(count / most) * 100}%`, background: 'var(--net-tone)' }} />
              </span>
              <span className="week-answers-tag-count ui-num">{formatCount(count)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OverviewPage({
  onOpenReports,
  onOpenTab,
  onOpenAccount,
  onOpenCall,
  onOpenLiveRoom
}: {
  onOpenReports: () => void;
  onOpenTab: (tab: AdminTab) => void;
  onOpenAccount: (accountId: string) => void;
  onOpenCall: (call: CallRef) => void;
  /** Opens the rooms section with this room's call unfolded. */
  onOpenLiveRoom: (roomId: string) => void;
}) {
  const canReview = useCan('reports.review');
  const canRooms = useCan('rooms.view');
  const dashboard = useAdminResource(loadDashboard, [], {
    failureText: 'Не удалось загрузить обзор',
    refreshMs: REFRESH_MS
  });
  const live = useAdminResource(() => (canRooms ? fetchLiveRooms() : Promise.resolve(null)), [canRooms], {
    failureText: 'Не удалось загрузить звонки',
    refreshMs: LIVE_REFRESH_MS
  });
  const recent = useAdminResource(() => (canRooms ? fetchRoomCalls({}) : Promise.resolve(null)), [canRooms], {
    failureText: 'Не удалось загрузить звонки',
    refreshMs: REFRESH_MS
  });
  const [period, setPeriod] = useState<HoursPeriod>('14d');
  const hours = useAdminResource(
    () => fetchProductStats(productQuery({ kind: 'preset', id: period }, PRODUCT_PRESETS, Date.now())),
    [period],
    { failureText: 'Не удалось загрузить часы в войсе', refreshMs: REFRESH_MS }
  );

  const { reload: reloadDashboard } = dashboard;
  const { reload: reloadLive } = live;
  const { reload: reloadRecent } = recent;
  const { reload: reloadHours } = hours;
  const reload = useCallback(() => {
    reloadDashboard();
    reloadLive();
    reloadRecent();
    reloadHours();
  }, [reloadDashboard, reloadLive, reloadRecent, reloadHours]);
  useRefreshStatus(
    canRooms
      ? { at: live.loadedAt, everyMs: LIVE_REFRESH_MS, busy: live.busy, reload, what: 'звонки' }
      : { at: dashboard.loadedAt, everyMs: REFRESH_MS, busy: dashboard.busy, reload }
  );

  if (dashboard.failure && !dashboard.data) return <Notice failure={dashboard.failure} onRetry={reloadDashboard} />;
  if (!dashboard.data || dashboard.heardAt === null) {
    return (
      <p className="dash-quiet" aria-busy="true">
        Загружаем…
      </p>
    );
  }

  const [overview, product, system] = dashboard.data;
  const now = Math.max(dashboard.heardAt, live.heardAt ?? 0);
  const rooms = live.data?.rooms ?? null;
  const calls = recent.data?.calls.slice(0, RECENT_CALLS) ?? null;
  const days = product.days;
  const samples = system.samples;
  const dayLabels = days.map((day) => formatDay(day.day));
  const sampleLabels = samples.map((sample) => formatSampleTime(sample.at, false));
  const today = days.at(-1) ?? null;
  const yesterday = days.at(-2) ?? null;
  const voiceHours = (day: ProductStats['days'][number] | null) =>
    day ? Math.round((day.voiceAccountHours + day.voiceGuestHours) * 10) / 10 : 0;
  const newThisWeek = days.slice(-7).reduce((sum, day) => sum + day.newAccounts, 0);
  const finishedToday = overview.today.calls;
  const liveCount = rooms?.length ?? overview.live.voiceRooms;
  const peopleInVoice = rooms?.reduce((sum, room) => sum + room.peers.length, 0) ?? 0;
  const callsToday = (recent.data?.calls ?? []).filter((call) => formatShortDay(call.startedAt, now) === 'сегодня');
  const callsTodayMs = callsToday.reduce((sum, call) => sum + (call.endedAt - call.startedAt), 0);
  const callsTodayCount = finishedToday ?? callsToday.length;
  const hoursDays = hours.data?.days ?? [];
  const hoursToday = voiceHours(hoursDays.at(-1) ?? null);
  const hoursYesterday = voiceHours(hoursDays.at(-2) ?? null);
  const callsNote = (failure: typeof live.failure, retry: () => void) =>
    failure ? <Notice failure={failure} onRetry={retry} /> : null;

  return (
    <>
      <Attention
        overview={overview}
        rooms={rooms}
        calls={calls}
        canReview={canReview}
        now={now}
        onOpenReports={onOpenReports}
        onOpenTab={onOpenTab}
        onOpenAccount={onOpenAccount}
        onOpenCall={onOpenCall}
      />

      <Stats label="Главное сейчас" min={160}>
        <Stat
          label="Онлайн сейчас"
          dot="accent"
          value={formatCount(overview.live.onlineAccounts)}
          note={`и ${formatCount(overview.live.guestConnections)} гостевых подключений`}
        />
        <Stat
          label="В войсе сейчас"
          dot="success"
          value={formatCount(overview.live.voicePeers)}
          note={`в ${formatCount(overview.live.voiceRooms)} комнатах`}
        />
        <Stat
          label="Часов в войсе сегодня"
          dot="success"
          value={formatHours(voiceHours(today))}
          note={<Delta current={voiceHours(today)} previous={voiceHours(yesterday)} unit="ч к вчера" />}
        />
        {finishedToday !== undefined ? (
          <Stat
            label="Звонков сегодня"
            value={formatCount(finishedToday + liveCount)}
            note={
              <>
                <Delta current={finishedToday} previous={overview.today.callsYesterday ?? 0} unit="к вчера" />
                {` · ${formatCount(liveCount)} идут`}
              </>
            }
          />
        ) : null}
        <Stat
          label="Активны сегодня"
          dot="accent"
          value={formatCount(overview.today.activeAccounts)}
          note={
            <Delta current={overview.today.activeAccounts} previous={yesterday?.activeAccounts ?? 0} unit="к вчера" />
          }
        />
        <Stat
          label="Новых сегодня"
          dot="info"
          value={formatCount(overview.today.newAccounts)}
          note={
            <>
              <Delta current={overview.today.newAccounts} previous={yesterday?.newAccounts ?? 0} unit="к вчера" />
              {` · ${formatCount(newThisWeek)} за неделю`}
            </>
          }
        />
      </Stats>

      <div className="dash-pair">
        {canRooms ? (
          <Section
            page="overview"
            id="live"
            title="Сейчас в звонках"
            className="dash-wide"
            summary={
              rooms?.length ? (
                <Pill tone="success" dot>
                  {`${formatCount(rooms.length)} ${plural(rooms.length, ['комната', 'комнаты', 'комнат'])} · ${formatPeople(peopleInVoice)}`}
                </Pill>
              ) : null
            }
            link={<TextLink onClick={() => onOpenTab('rooms')}>Все комнаты</TextLink>}
          >
            <LiveList
              rooms={rooms}
              failure={callsNote(live.failure, reloadLive)}
              now={now}
              onOpen={(room) => onOpenLiveRoom(room.roomId)}
            />
          </Section>
        ) : null}
        <Section
          page="overview"
          id="hours"
          title="Часы в войсе"
          className="dash-narrow"
          link={<Segment ariaLabel="Период" value={period} onChange={setPeriod} options={HOURS_PERIODS} />}
        >
          <HoursChart
            stats={hours.data}
            failure={hours.failure ? <Notice failure={hours.failure} onRetry={reloadHours} /> : null}
          />
          {hours.data ? (
            <p className="ui-footnote">
              {`Сегодня ${formatHours(hoursToday)} · вчера ${formatHours(hoursYesterday)}. Заход относится к дню, в который начался. `}
              <TextLink onClick={() => onOpenTab('product')}>Подробнее в «Продукте»</TextLink>
            </p>
          ) : null}
        </Section>
      </div>

      <div className="dash-pair">
        {canRooms ? (
          <Section
            page="overview"
            id="calls"
            title="Последние звонки"
            className="dash-wide"
            summary={
              <span className="ui-toolbar-note">
                {callsTodayCount
                  ? `сегодня ${formatCount(callsTodayCount)}${callsTodayMs ? ` · ${formatDuration(callsTodayMs)}` : ''}`
                  : 'сегодня не было'}
              </span>
            }
            link={<TextLink onClick={() => onOpenTab('rooms')}>Вся история</TextLink>}
          >
            <RecentCalls
              calls={calls}
              failure={callsNote(recent.failure, reloadRecent)}
              now={now}
              onOpen={(call) => onOpenCall({ kind: 'finished', callId: call.id })}
            />
          </Section>
        ) : null}
        <div className="dash-narrow dash-stack">
          <Section
            page="overview"
            id="server"
            title="Сервер"
            summary={
              <Pill tone={overview.livekit ? 'success' : 'danger'} dot>
                {`LiveKit ${overview.livekit ? 'работает' : 'выключен'}`}
              </Pill>
            }
            link={<TextLink onClick={() => onOpenTab('system')}>Подробнее</TextLink>}
          >
            <Server overview={overview} system={system} now={now} />
          </Section>
          {overview.feedback ? (
            <Section
              page="overview"
              id="feedback"
              title="Отзывы за 7 дней"
              link={<TextLink onClick={() => onOpenTab('feedback')}>Все отзывы</TextLink>}
            >
              <FeedbackWeek overview={overview} />
            </Section>
          ) : null}
        </div>
      </div>

      <Section
        page="overview"
        id="growth"
        title="Рост и активность"
        defaultOpen={false}
        summary={<span className="ui-toolbar-note">активные, новые и онлайн за сутки</span>}
      >
        <div className="ui-grid" style={{ '--grid-min': '480px' }}>
          <TimeChart
            title="Активность за 14 дней"
            height={220}
            labels={dayLabels}
            series={[
              { name: 'Активные аккаунты', values: days.map((day) => day.activeAccounts), color: 'var(--vr-accent)' },
              { name: 'В войсе', values: days.map((day) => day.voiceAccounts), color: 'var(--vr-success)' },
              { name: 'Новые', values: days.map((day) => day.newAccounts), color: 'var(--vr-info)' }
            ]}
          />
          <TimeChart
            title="Онлайн за сутки"
            height={220}
            labels={sampleLabels}
            series={[
              {
                name: 'Вкладки и приложения',
                values: samples.map((sample) => sample.wsConnections),
                color: 'var(--vr-accent)'
              },
              { name: 'Гости', values: samples.map((sample) => sample.guestConnections), color: 'var(--vr-warning)' },
              { name: 'В войсе', values: samples.map((sample) => sample.voicePeers), color: 'var(--vr-success)' }
            ]}
          />
          <TimeChart
            title="Нагрузка за сутки"
            labels={sampleLabels}
            format={wholePercent}
            height={220}
            series={[
              { name: 'Процессор', values: samples.map((sample) => sample.cpuPct), color: 'var(--vr-accent)' },
              {
                name: 'Память',
                values: samples.map((sample) => percent(sample.memUsedBytes, sample.memTotalBytes)),
                color: 'var(--vr-warning)'
              }
            ]}
          />
        </div>
      </Section>
    </>
  );
}
