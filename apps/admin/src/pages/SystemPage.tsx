// The server minute by minute, as the API recorded it: processor, memory,
// disk, database, the API process, live connections and requests; the latest
// minute as a strip of numbers over the charts.

import { useEffect, useState } from 'react';
import type { SystemSample, SystemStats } from '@voice-room/shared/contracts/admin';
import { fetchSystemStats } from '../api/admin.ts';
import { TimeChart } from '../charts/TimeChart.tsx';
import { formatBytes, formatMs, formatPercent, formatSampleTime } from '../format.ts';
import { loadFailure, type LoadFailure } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { SYSTEM_PRESETS, systemQuery, type TimeRange } from '../time-range.ts';
import { TimeRangePicker } from '../TimeRangePicker.tsx';
import { Stat, Stats, type Tone } from '../ui/index.tsx';
import './SystemPage.css';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 24 * 60 * 60 * 1000;

const gb = (value: number) => `${value.toFixed(1)} ГБ`;
const mb = (value: number) => `${Math.round(value)} МБ`;
const wholePercent = (value: number) => `${Math.round(value)}%`;

function share(used: number | null, total: number | null): number | null {
  return used !== null && total ? (used / total) * 100 : null;
}

/** A share's status: green under 70%, amber under 90%, red above; grey when not measured. */
function toneOf(value: number | null): Tone {
  if (value === null) return 'neutral';
  return value < 70 ? 'success' : value < 90 ? 'warning' : 'danger';
}

export function SystemPage() {
  const [range, setRange] = useState<TimeRange>({ kind: 'preset', id: '24h' });
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A slower answer for a range already left behind is dropped.
    let current = true;
    fetchSystemStats(systemQuery(range, SYSTEM_PRESETS, Date.now())).then(
      (loaded) => {
        if (!current) return;
        setStats(loaded);
        setFailure(null);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!current) return;
        setFailure(loadFailure(cause, 'Не удалось загрузить данные сервера'));
        setLoading(false);
      }
    );
    return () => {
      current = false;
    };
  }, [range, attempt]);

  function change(next: TimeRange): void {
    setRange(next);
    setLoading(true);
  }

  function retry(): void {
    setLoading(true);
    setAttempt((count) => count + 1);
  }

  const resolved = stats ? { from: stats.from, to: stats.to } : null;

  const picker = (
    <>
      <TimeRangePicker value={range} presets={SYSTEM_PRESETS} withTime onChange={change} resolved={resolved} />
      {loading && stats ? <span className="system-quiet">Обновляем…</span> : null}
    </>
  );
  const toolbar = <div className="ui-toolbar">{picker}</div>;

  if (failure && !stats) {
    return (
      <>
        {toolbar}
        <Notice failure={failure} onRetry={retry} />
      </>
    );
  }
  if (!stats) {
    return (
      <>
        {toolbar}
        <p className="system-quiet" aria-busy="true">
          Загружаем…
        </p>
      </>
    );
  }
  const samples = stats.samples;
  if (samples.length === 0) {
    return (
      <>
        {toolbar}
        <p className="system-quiet">Замеров за этот период нет: сервер записывает их раз в минуту.</p>
      </>
    );
  }

  // Spans longer than a day show the date with the clock.
  const withDate = stats.to - stats.from > DAY;
  const labels = samples.map((sample) => formatSampleTime(sample.at, withDate));
  const scaled = (pick: (sample: SystemSample) => number | null, unit: number) =>
    samples.map((sample) => {
      const value = pick(sample);
      return value === null ? null : value / unit;
    });
  const bucketNote = `Точка — ${
    stats.bucketSeconds >= 3600 ? `${stats.bucketSeconds / 3600} ч` : `${stats.bucketSeconds / 60} мин`
  }, показан максимум за этот отрезок.`;
  const latest = samples.at(-1);

  return (
    <>
      <div className="ui-toolbar">
        {picker}
        <span className="ui-toolbar-note">{bucketNote}</span>
      </div>
      {latest ? (
        <Stats label="Сейчас" min={160}>
          <Stat
            label="Процессор"
            value={formatPercent(latest.cpuPct)}
            dot={toneOf(latest.cpuPct)}
            note={`нагрузка ${latest.load1.toFixed(2)}`}
          />
          <Stat
            label="Память"
            value={formatPercent(share(latest.memUsedBytes, latest.memTotalBytes))}
            dot={toneOf(share(latest.memUsedBytes, latest.memTotalBytes))}
            note={`${formatBytes(latest.memUsedBytes)} из ${formatBytes(latest.memTotalBytes)}`}
          />
          <Stat
            label="Диск"
            value={formatPercent(share(latest.diskUsedBytes, latest.diskTotalBytes))}
            dot={toneOf(share(latest.diskUsedBytes, latest.diskTotalBytes))}
            note={`${formatBytes(latest.diskUsedBytes)} из ${formatBytes(latest.diskTotalBytes)}`}
          />
          <Stat label="База" value={formatBytes(latest.dbBytes)} dot="neutral" note="размер на диске" />
          <Stat label="Процесс API" value={formatBytes(latest.apiRssBytes)} dot="neutral" note="память процесса" />
          <Stat
            label="Средний ответ"
            value={formatMs(latest.httpAvgMs)}
            dot="neutral"
            note={`задержка цикла ${formatMs(latest.eventLoopP99Ms)}`}
          />
        </Stats>
      ) : null}
      <div className="ui-grid" style={{ '--grid-min': '480px' }}>
        <TimeChart
          title="Процессор"
          labels={labels}
          format={wholePercent}
          series={[{ name: 'Загрузка', values: samples.map((sample) => sample.cpuPct), color: 'var(--vr-accent)' }]}
          note="Весь сервер, все ядра."
        />
        <TimeChart
          title="Память сервера"
          labels={labels}
          format={gb}
          series={[
            { name: 'Занято', values: scaled((sample) => sample.memUsedBytes, GB), color: 'var(--vr-accent)' },
            {
              name: 'Всего',
              values: scaled((sample) => sample.memTotalBytes, GB),
              color: 'var(--vr-text-3)',
              dashed: true
            }
          ]}
        />
        <TimeChart
          title="Диск"
          labels={labels}
          format={gb}
          series={[
            { name: 'Занято', values: scaled((sample) => sample.diskUsedBytes, GB), color: 'var(--vr-warning)' },
            {
              name: 'Всего',
              values: scaled((sample) => sample.diskTotalBytes, GB),
              color: 'var(--vr-text-3)',
              dashed: true
            }
          ]}
        />
        <TimeChart
          title="База данных"
          labels={labels}
          format={mb}
          series={[{ name: 'Размер', values: scaled((sample) => sample.dbBytes, MB), color: 'var(--vr-info)' }]}
        />
        <TimeChart
          title="Процесс API"
          labels={labels}
          format={mb}
          series={[{ name: 'Память', values: scaled((sample) => sample.apiRssBytes, MB), color: 'var(--vr-accent)' }]}
        />
        <TimeChart
          title="Задержка API"
          labels={labels}
          format={formatMs}
          series={[
            { name: 'Средний ответ', values: samples.map((sample) => sample.httpAvgMs), color: 'var(--vr-accent)' },
            {
              name: 'Задержка цикла (p99)',
              values: samples.map((sample) => sample.eventLoopP99Ms),
              color: 'var(--vr-warning)'
            }
          ]}
        />
        <TimeChart
          title="Подключения"
          labels={labels}
          series={[
            {
              name: 'Вкладки и приложения',
              values: samples.map((sample) => sample.wsConnections),
              color: 'var(--vr-accent)'
            },
            {
              name: 'Из них гостей',
              values: samples.map((sample) => sample.guestConnections),
              color: 'var(--vr-warning)'
            },
            { name: 'В войсе', values: samples.map((sample) => sample.voicePeers), color: 'var(--vr-success)' }
          ]}
        />
        <TimeChart
          title="Запросы"
          kind="bar"
          labels={labels}
          series={[
            {
              name: 'Успешные',
              values: samples.map((sample) => sample.httpRequests - sample.http5xx),
              color: 'var(--vr-accent)'
            },
            { name: 'Ошибки сервера (5xx)', values: samples.map((sample) => sample.http5xx), color: 'var(--vr-danger)' }
          ]}
        />
      </div>
    </>
  );
}
