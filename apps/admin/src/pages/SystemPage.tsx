// The server minute by minute, as the API recorded it: processor, memory,
// disk, database, the API process, the media server (LiveKit's traffic, the
// packets it lost each way, its CPU and memory), live connections and
// requests; the latest minute as a strip of numbers over the charts.

import { useState } from 'react';
import type { SystemSample } from '@voice-room/shared/contracts/admin';
import { networkLevelOfValue } from '@voice-room/shared/network-quality';
import { fetchSystemStats } from '../api/admin.ts';
import { TimeChart } from '../charts/TimeChart.tsx';
import { formatBytes, formatMs, formatPercent, formatSampleTime } from '../format.ts';
import { useAdminResource } from '../load-state.ts';
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

const oneDecimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const mbit = (value: number) => `${oneDecimal.format(value)} Мбит/с`;
// Server-wide loss is usually well under a percent: two decimals tell 0.05 % from 0.5 %.
const twoDecimals = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const lossPercent = (value: number) => `${twoDecimals.format(value)}%`;
const lossText = (value: number | null) => (value === null ? '—' : lossPercent(value));

/** A minute's bytes as megabits a second; a point keeps its busiest minute. */
function mbps(bytes: number | null): number | null {
  return bytes === null ? null : (bytes * 8) / 60 / 1_000_000;
}

/** Fewer packets than this in a point give no loss figure: a few seconds of one voice. */
const MEDIA_MIN_PACKETS = 500;

/** Lost packets over all of them, in percent; null where there were too few to tell. */
function lossShare(lost: number | null, packets: number | null): number | null {
  if (lost === null || packets === null || packets < MEDIA_MIN_PACKETS) return null;
  return (Math.min(lost, packets) / packets) * 100;
}

/** On the way in LiveKit counts what arrived; the lost packets come on top. */
const lossIn = (sample: SystemSample) =>
  lossShare(sample.sfuLostIn, sample.sfuPacketsIn === null ? null : sample.sfuPacketsIn + (sample.sfuLostIn ?? 0));
/** On the way out the listeners' receivers report what never reached them of all that was sent. */
const lossOut = (sample: SystemSample) => lossShare(sample.sfuLostOut, sample.sfuPacketsOut);
const retransmitShare = (sample: SystemSample) =>
  sample.sfuRetransmitOut === null || sample.sfuPacketsOut === null || sample.sfuPacketsOut < MEDIA_MIN_PACKETS
    ? null
    : (sample.sfuRetransmitOut / sample.sfuPacketsOut) * 100;

const LEVEL_TONE = { good: 'success', unstable: 'warning', bad: 'danger' } as const;

/** Loss by the calls' own lines (shared with the room and the timelines); grey when not measured. */
function lossTone(value: number | null): Tone {
  const level = networkLevelOfValue('lossPct', value);
  return level ? LEVEL_TONE[level] : 'neutral';
}

function worse(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : Math.max(a, b);
}

/** A share's status: green under 70%, amber under 90%, red above; grey when not measured. */
function toneOf(value: number | null): Tone {
  if (value === null) return 'neutral';
  return value < 70 ? 'success' : value < 90 ? 'warning' : 'danger';
}

export function SystemPage() {
  const [range, setRange] = useState<TimeRange>({ kind: 'preset', id: '24h' });
  // A slower answer for a range already left behind is dropped.
  const {
    data: stats,
    failure,
    busy: loading,
    reload: retry
  } = useAdminResource(() => fetchSystemStats(systemQuery(range, SYSTEM_PRESETS, Date.now())), [range], {
    failureText: 'Не удалось загрузить данные сервера'
  });

  const resolved = stats ? { from: stats.from, to: stats.to } : null;

  const picker = (
    <>
      <TimeRangePicker value={range} presets={SYSTEM_PRESETS} withTime onChange={setRange} resolved={resolved} />
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
            label="Медиасервер"
            value={
              latest.sfuBytesIn === null
                ? '—'
                : `↓ ${mbit(mbps(latest.sfuBytesIn) ?? 0)} · ↑ ${mbit(mbps(latest.sfuBytesOut) ?? 0)}`
            }
            dot="neutral"
            note={
              latest.sfuRssBytes === null
                ? 'LiveKit не ответил'
                : `процессор ${formatPercent(latest.sfuCpuPct)}, память ${formatBytes(latest.sfuRssBytes)}`
            }
          />
          <Stat
            label="Потери медиа"
            value={`${lossText(lossIn(latest))} / ${lossText(lossOut(latest))}`}
            dot={lossTone(worse(lossIn(latest), lossOut(latest)))}
            note="к серверу / от сервера"
          />
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
          series={[
            { name: 'Загрузка', values: samples.map((sample) => sample.cpuPct), color: 'var(--vr-accent)' },
            { name: 'Из них LiveKit', values: samples.map((sample) => sample.sfuCpuPct), color: 'var(--vr-info)' }
          ]}
          note="Весь сервер, все ядра; LiveKit — его доля в том же масштабе."
        />
        <TimeChart
          title="Трафик медиасервера"
          labels={labels}
          format={mbit}
          series={[
            { name: 'К серверу', values: samples.map((sample) => mbps(sample.sfuBytesIn)), color: 'var(--vr-accent)' },
            {
              name: 'От сервера',
              values: samples.map((sample) => mbps(sample.sfuBytesOut)),
              color: 'var(--vr-success)'
            }
          ]}
          note="Голос, видео и демонстрации всех звонков; самая загруженная минута точки."
        />
        <TimeChart
          title="Потери пакетов"
          labels={labels}
          format={lossPercent}
          series={[
            { name: 'К серверу', values: samples.map(lossIn), color: 'var(--vr-accent)' },
            { name: 'От сервера', values: samples.map(lossOut), color: 'var(--vr-warning)' },
            {
              name: 'Отправлено повторно',
              values: samples.map(retransmitShare),
              color: 'var(--vr-text-3)',
              dashed: true
            }
          ]}
          note={`Доля за всю точку: потерянные из всех пакетов медиасервера. К серверу — от говорящих, от сервера — по отчётам слушателей. Меньше ${MEDIA_MIN_PACKETS} пакетов — без цифры.`}
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
          title="Память процессов"
          labels={labels}
          format={mb}
          series={[
            { name: 'API', values: scaled((sample) => sample.apiRssBytes, MB), color: 'var(--vr-accent)' },
            { name: 'LiveKit', values: scaled((sample) => sample.sfuRssBytes, MB), color: 'var(--vr-info)' }
          ]}
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
