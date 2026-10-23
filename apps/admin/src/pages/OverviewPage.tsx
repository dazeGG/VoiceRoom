// The dashboard of the whole panel: the headline numbers with how they moved,
// two weeks of activity, the last day online, and how the server is doing.
// Refreshes itself every half minute while it is on screen.

import { ArrowDownRight, ArrowUpRight, Flag } from 'lucide-react';
import type { AdminOverview, ProductDay, ProductStats, SystemStats } from '@voice-room/shared/contracts/admin';
import { fetchOverview, fetchProductStats, fetchSystemStats } from '../api/admin.ts';
import { Sparkline } from '../charts/Sparkline.tsx';
import { TimeChart } from '../charts/TimeChart.tsx';
import {
  formatBytes,
  formatCount,
  formatDay,
  formatHours,
  formatPercent,
  formatSampleTime,
  formatSince
} from '../format.ts';
import { useRefreshStatus } from '../frame.tsx';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useCan } from '../staff.tsx';
import { PRODUCT_PRESETS, productQuery } from '../time-range.ts';
import { Button, Pill } from '../ui/index.tsx';
import './OverviewPage.css';

const REFRESH_MS = 30_000;
const DAY = 24 * 60 * 60 * 1000;

function sum(days: readonly ProductDay[], from: number, to: number, pick: (day: ProductDay) => number): number {
  return days.slice(Math.max(0, from), Math.max(0, to)).reduce((total, day) => total + pick(day), 0);
}

const messagesOf = (day: ProductDay | null) => (day ? day.roomMessages + day.directMessages : 0);
const voiceHoursOf = (day: ProductDay | null) => (day ? day.voiceAccountHours + day.voiceGuestHours : 0);

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
  if (change === 0) {
    return (
      <span className="kpi-delta" data-direction="flat">
        без изменений
      </span>
    );
  }
  const Icon = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="kpi-delta" data-direction={change > 0 ? 'up' : 'down'}>
      <Icon size={16} aria-hidden="true" />
      {`${change > 0 ? '+' : ''}${change} ${unit}`}
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
  trend,
  color,
  change
}: {
  label: string;
  value: string;
  hint: string;
  trend: readonly (number | null)[];
  color: string;
  change?: { current: number; previous: number; unit: string } | undefined;
}) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-foot">
        {change ? <Delta {...change} /> : null}
        {hint ? <span className="kpi-hint">{hint}</span> : null}
      </span>
      <span className="kpi-spark">
        <Sparkline values={trend} color={color} height={44} label={`${label}: как менялось`} />
      </span>
    </div>
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

export function OverviewPage({ onOpenReports }: { onOpenReports: () => void }) {
  const canReview = useCan('reports.review');
  const { data, failure, busy, loadedAt, heardAt, reload } = useAdminResource(loadDashboard, [], {
    failureText: 'Не удалось загрузить обзор',
    refreshMs: REFRESH_MS
  });
  useRefreshStatus({ at: loadedAt, everyMs: REFRESH_MS, busy, reload });

  if (failure && !data) return <Notice failure={failure} onRetry={reload} />;
  if (!data || heardAt === null) {
    return (
      <p className="dash-quiet" aria-busy="true">
        Загружаем…
      </p>
    );
  }

  const [overview, product, system] = data;
  const now = heardAt;
  const days = product.days;
  const samples = system.samples;
  const dayLabels = days.map((day) => formatDay(day.day));
  const sampleLabels = samples.map((sample) => formatSampleTime(sample.at, false));
  const today = days.at(-1) ?? null;
  const yesterday = days.at(-2) ?? null;
  const newThisWeek = sum(days, days.length - 7, days.length, (day) => day.newAccounts);
  const newLastWeek = sum(days, days.length - 14, days.length - 7, (day) => day.newAccounts);

  const latest = overview.system;
  const gauges = latest
    ? [
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
      ]
    : [];

  return (
    <>
      {canReview && overview.openReports > 0 ? (
        <div className="dash-reports" role="status">
          <Flag size={16} aria-hidden="true" />
          <span>
            Открытых жалоб: <strong>{overview.openReports}</strong>
          </span>
          <Button variant="danger" className="dash-reports-go" onClick={onOpenReports}>
            Разобрать
          </Button>
        </div>
      ) : null}

      <section className="kpis" aria-label="Главное">
        <Kpi
          label="Онлайн сейчас"
          value={formatCount(overview.live.onlineAccounts)}
          hint={`и ${formatCount(overview.live.guestConnections)} гостевых подключений`}
          trend={samples.map((sample) => sample.wsConnections)}
          color="var(--vr-accent)"
        />
        <Kpi
          label="В войсе сейчас"
          value={formatCount(overview.live.voicePeers)}
          hint={`в ${formatCount(overview.live.voiceRooms)} комнатах`}
          trend={samples.map((sample) => sample.voicePeers)}
          color="var(--vr-success)"
        />
        <Kpi
          label="Активны сегодня"
          value={formatCount(overview.today.activeAccounts)}
          hint={`за 7 дней ${formatCount(overview.totals.weeklyActive)}, за 30 — ${formatCount(overview.totals.monthlyActive)}`}
          trend={days.map((day) => day.activeAccounts)}
          color="var(--vr-accent)"
          change={{
            current: overview.today.activeAccounts,
            previous: yesterday?.activeAccounts ?? 0,
            unit: 'к вчера'
          }}
        />
        <Kpi
          label="Новых за 7 дней"
          value={formatCount(newThisWeek)}
          hint={`всего аккаунтов ${formatCount(overview.totals.accounts)}`}
          trend={days.map((day) => day.newAccounts)}
          color="var(--vr-info)"
          change={{ current: newThisWeek, previous: newLastWeek, unit: 'к прошлой неделе' }}
        />
        <Kpi
          label="Сообщений сегодня"
          value={formatCount(overview.today.messages)}
          hint={`всего ${formatCount(overview.totals.messages)}`}
          trend={days.map(messagesOf)}
          color="var(--vr-info)"
          change={{ current: messagesOf(today), previous: messagesOf(yesterday), unit: 'к вчера' }}
        />
        <Kpi
          label="Часов в войсе сегодня"
          value={formatHours(voiceHoursOf(today))}
          hint={`${formatCount(overview.today.voiceJoins)} заходов`}
          trend={days.map(voiceHoursOf)}
          color="var(--vr-success)"
          change={{ current: voiceHoursOf(today), previous: voiceHoursOf(yesterday), unit: 'ч к вчера' }}
        />
      </section>

      <div className="ui-grid" style={{ '--grid-min': '520px' }}>
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
      </div>

      <div className="dash-row">
        <section className="ui-panel dash-server" aria-label="Сервер">
          <div className="dash-server-head">
            <h3 className="ui-panel-title">Сервер</h3>
            <Pill tone={overview.livekit ? 'success' : 'danger'} dot>
              {`LiveKit ${overview.livekit ? 'работает' : 'выключен'}`}
            </Pill>
          </div>
          <p className="dash-quiet">
            {`Версия ${overview.version} · работает ${formatSince(overview.startedAt, now)} ${
              latest ? `· замер ${formatSince(latest.at, now)} назад` : '· замеров ещё нет'
            }`}
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
          <div className="gauge-facts">
            <span>
              База <strong>{formatBytes(latest?.dbBytes ?? null)}</strong>
            </span>
            <span>
              Память API <strong>{formatBytes(latest?.apiRssBytes ?? null)}</strong>
            </span>
          </div>
        </section>
        <div className="dash-load">
          <TimeChart
            title="Нагрузка за сутки"
            labels={sampleLabels}
            format={wholePercent}
            height={190}
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
      </div>
    </>
  );
}
