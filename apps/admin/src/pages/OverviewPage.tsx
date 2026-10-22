// The dashboard of the whole panel: the headline numbers with how they moved,
// two weeks of activity, the last day online, and how the server is doing.
// Refreshes itself every half minute while it is on screen.

import { ArrowDownRight, ArrowUpRight, Flag } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
import { loadFailure, type LoadFailure } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useCan } from '../staff.tsx';
import { PRODUCT_PRESETS, productQuery } from '../time-range.ts';
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
      <Sparkline values={trend} color={color} label={`${label}: как менялось`} />
    </div>
  );
}

export function OverviewPage({ onOpenReports }: { onOpenReports: () => void }) {
  const canReview = useCan('reports.review');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [product, setProduct] = useState<ProductStats | null>(null);
  const [system, setSystem] = useState<SystemStats | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [now, setNow] = useState(Date.now);

  const [attempt, setAttempt] = useState(0);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  useRefreshStatus({ at: loadedAt, everyMs: REFRESH_MS, busy, reload });

  useEffect(() => {
    let current = true;
    let inFlight = false;
    const load = () => {
      // A slow answer is waited for, not piled on: one round at a time keeps answers in order.
      if (inFlight) return;
      inFlight = true;
      setBusy(true);
      const at = Date.now();
      Promise.all([
        fetchOverview(),
        fetchProductStats(productQuery({ kind: 'preset', id: '14d' }, PRODUCT_PRESETS, at)),
        fetchSystemStats({ from: String(at - DAY), to: String(at) })
      ])
        .then(
          ([nextOverview, nextProduct, nextSystem]) => {
            if (!current) return;
            setOverview(nextOverview);
            setProduct(nextProduct);
            setSystem(nextSystem);
            setFailure(null);
            setNow(Date.now());
            setLoadedAt(Date.now());
          },
          (cause: unknown) => {
            if (!current) return;
            setFailure(loadFailure(cause, 'Не удалось загрузить обзор'));
            setNow(Date.now());
          }
        )
        .finally(() => {
          inFlight = false;
          if (current) setBusy(false);
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [attempt]);

  if (failure && !overview) return <Notice failure={failure} onRetry={reload} />;
  if (!overview) {
    return (
      <p className="dash-quiet" aria-busy="true">
        Загружаем…
      </p>
    );
  }

  const days = product?.days ?? [];
  const samples = system?.samples ?? [];
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
          <button type="button" className="dash-link" onClick={onOpenReports}>
            Посмотреть
          </button>
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

      <div className="dash-charts">
        <TimeChart
          title="Активность за 14 дней"
          labels={dayLabels}
          series={[
            { name: 'Активные аккаунты', values: days.map((day) => day.activeAccounts), color: 'var(--vr-accent)' },
            { name: 'В войсе', values: days.map((day) => day.voiceAccounts), color: 'var(--vr-success)' },
            { name: 'Новые', values: days.map((day) => day.newAccounts), color: 'var(--vr-info)' }
          ]}
        />
        <TimeChart
          title="Онлайн за сутки"
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

      <section className="dash-server" aria-label="Сервер">
        <div className="dash-server-head">
          <h2>Сервер</h2>
          <span className="dash-chip" data-state={overview.livekit ? 'ok' : 'bad'}>
            {`LiveKit ${overview.livekit ? 'работает' : 'выключен'}`}
          </span>
          <span className="dash-quiet">
            {`Версия ${overview.version} · работает ${formatSince(overview.startedAt, now)} ${
              latest ? `· замер ${formatSince(latest.at, now)} назад` : '· замеров ещё нет'
            }`}
          </span>
        </div>
        <div className="dash-server-body">
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
            <div className="gauge-facts">
              <span>
                База <strong>{formatBytes(latest?.dbBytes ?? null)}</strong>
              </span>
              <span>
                Память API <strong>{formatBytes(latest?.apiRssBytes ?? null)}</strong>
              </span>
            </div>
          </div>
          <TimeChart
            title="Нагрузка за сутки"
            labels={sampleLabels}
            format={wholePercent}
            height={150}
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
      </section>
    </>
  );
}
