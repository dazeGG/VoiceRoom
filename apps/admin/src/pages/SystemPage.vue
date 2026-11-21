<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type { SystemSample } from '@voice-room/shared/contracts/admin';
import { networkLevelOfValue } from '@voice-room/shared/network-quality';
import { fetchSystemStats } from '../api/admin.ts';
import { formatBytes, formatMs, formatPercent, formatSampleTime } from '../format.ts';
import { SYSTEM_PRESETS, systemQuery, type TimeRange } from '../time-range.ts';
import { Stat, Stats, type Tone } from '../ui';
import { lossIn, lossOut, MEDIA_MIN_PACKETS, percent } from './system-metrics.ts';
import TimeChart from '../charts/TimeChart.vue';
import type { ChartSeries } from '../charts/chart-series.ts';
import Notice from '../Notice.vue';
import TimeRangePicker from '../TimeRangePicker.vue';
import { useAdminResource } from '../use-admin-resource.ts';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 24 * 60 * 60 * 1000;

const gb = (value: number) => `${value.toFixed(1)} ГБ`;
const mb = (value: number) => `${Math.round(value)} МБ`;
const wholePercent = (value: number) => `${Math.round(value)}%`;

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

const range = shallowRef<TimeRange>({ kind: 'preset', id: '24h' });
const {
  data: stats,
  failure,
  busy: loading,
  reload: retry
} = useAdminResource(() => fetchSystemStats(systemQuery(range.value, SYSTEM_PRESETS, Date.now())), [range], {
  failureText: 'Не удалось загрузить данные сервера'
});
const resolved = computed(() => (stats.value ? { from: stats.value.from, to: stats.value.to } : null));
const latest = computed(() => stats.value?.samples.at(-1));
const labels = computed(() => {
  const answer = stats.value;
  return answer?.samples.map((sample) => formatSampleTime(sample.at, answer.to - answer.from > DAY)) ?? [];
});
const bucketNote = computed(() => {
  const seconds = stats.value?.bucketSeconds;
  if (!seconds) return '';
  const span = seconds >= 3600 ? `${seconds / 3600} ч` : `${seconds / 60} мин`;
  return `Точка — ${span}, показан максимум за этот отрезок.`;
});
const charts = computed<
  { title: string; series: ChartSeries[]; kind?: 'bar'; format?: (value: number) => string; note?: string }[]
>(() => {
  const samples = stats.value?.samples ?? [];
  const scaled = (pick: (sample: SystemSample) => number | null, unit: number) =>
    samples.map((sample) => {
      const value = pick(sample);
      return value === null ? null : value / unit;
    });
  return [
    {
      title: 'Процессор',
      format: wholePercent,
      series: [
        { name: 'Загрузка', values: samples.map((sample) => sample.cpuPct), color: 'var(--vr-accent)' },
        { name: 'Из них LiveKit', values: samples.map((sample) => sample.sfuCpuPct), color: 'var(--vr-info)' }
      ],
      note: 'Весь сервер, все ядра; LiveKit — его доля в том же масштабе.'
    },
    {
      title: 'Трафик медиасервера',
      format: mbit,
      series: [
        { name: 'К серверу', values: samples.map((sample) => mbps(sample.sfuBytesIn)), color: 'var(--vr-accent)' },
        {
          name: 'От сервера',
          values: samples.map((sample) => mbps(sample.sfuBytesOut)),
          color: 'var(--vr-success)'
        }
      ],
      note: 'Голос, видео и демонстрации всех звонков; самая загруженная минута точки.'
    },
    {
      title: 'Потери пакетов',
      format: lossPercent,
      series: [
        { name: 'К серверу', values: samples.map(lossIn), color: 'var(--vr-accent)' },
        { name: 'От сервера', values: samples.map(lossOut), color: 'var(--vr-warning)' },
        {
          name: 'Отправлено повторно',
          values: samples.map(retransmitShare),
          color: 'var(--vr-text-3)',
          dashed: true
        }
      ],
      note: `Доля за всю точку: потерянные из всех пакетов медиасервера. К серверу — от говорящих, от сервера — по отчётам слушателей. Меньше ${MEDIA_MIN_PACKETS} пакетов — без цифры.`
    },
    {
      title: 'Память сервера',
      format: gb,
      series: [
        { name: 'Занято', values: scaled((sample) => sample.memUsedBytes, GB), color: 'var(--vr-accent)' },
        {
          name: 'Всего',
          values: scaled((sample) => sample.memTotalBytes, GB),
          color: 'var(--vr-text-3)',
          dashed: true
        }
      ]
    },
    {
      title: 'Диск',
      format: gb,
      series: [
        { name: 'Занято', values: scaled((sample) => sample.diskUsedBytes, GB), color: 'var(--vr-warning)' },
        {
          name: 'Всего',
          values: scaled((sample) => sample.diskTotalBytes, GB),
          color: 'var(--vr-text-3)',
          dashed: true
        }
      ]
    },
    {
      title: 'База данных',
      format: mb,
      series: [{ name: 'Размер', values: scaled((sample) => sample.dbBytes, MB), color: 'var(--vr-info)' }]
    },
    {
      title: 'Видео',
      series: [
        {
          name: 'Демонстрации экрана',
          values: samples.map((sample) => sample.videoScreensMax),
          color: 'var(--vr-accent)'
        },
        { name: 'Камеры', values: samples.map((sample) => sample.videoCamerasMax), color: 'var(--vr-success)' }
      ],
      note: 'Сколько шло одновременно, пик за точку. Только числа, без людей и комнат.'
    },
    {
      title: 'Видеотрафик',
      format: mbit,
      series: [
        { name: 'Выдано', values: samples.map((sample) => sample.videoMbpsMax), color: 'var(--vr-accent)' },
        {
          name: 'Лимит',
          values: samples.map((sample) => sample.videoBudgetMbps),
          color: 'var(--vr-text-3)',
          dashed: true
        }
      ],
      note: 'Сколько видео сервер раздаёт зрителям по своему расчёту, пик за точку; лимит — самый низкий за точку, он меньше, когда в голосе много людей.'
    },
    {
      title: 'Ограничения видео',
      kind: 'bar',
      series: [
        {
          name: 'Урезано качество',
          values: samples.map((sample) => sample.mediaLowered),
          color: 'var(--vr-warning)'
        },
        { name: 'Отказано', values: samples.map((sample) => sample.mediaRefused), color: 'var(--vr-danger)' }
      ],
      note: 'Старты стримов, которые сервер пустил в пониженном качестве или не пустил: занят или в комнате уже предел экранов.'
    },
    {
      title: 'Память процессов',
      format: mb,
      series: [
        { name: 'API', values: scaled((sample) => sample.apiRssBytes, MB), color: 'var(--vr-accent)' },
        { name: 'LiveKit', values: scaled((sample) => sample.sfuRssBytes, MB), color: 'var(--vr-info)' }
      ]
    },
    {
      title: 'Задержка API',
      format: formatMs,
      series: [
        { name: 'Средний ответ', values: samples.map((sample) => sample.httpAvgMs), color: 'var(--vr-accent)' },
        {
          name: 'Задержка цикла (p99)',
          values: samples.map((sample) => sample.eventLoopP99Ms),
          color: 'var(--vr-warning)'
        }
      ]
    },
    {
      title: 'Подключения',
      series: [
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
      ]
    },
    {
      title: 'Запросы',
      kind: 'bar',
      series: [
        {
          name: 'Успешные',
          values: samples.map((sample) => sample.httpRequests - sample.http5xx),
          color: 'var(--vr-accent)'
        },
        { name: 'Ошибки сервера (5xx)', values: samples.map((sample) => sample.http5xx), color: 'var(--vr-danger)' }
      ]
    }
  ];
});
</script>

<template>
  <div class="admin-metric-toolbar">
    <TimeRangePicker :value="range" :presets="SYSTEM_PRESETS" with-time :resolved="resolved" @change="range = $event" />
    <span v-if="loading && stats" class="admin-metric-note">Обновляем…</span>
    <span v-if="latest" class="admin-metric-note">{{ bucketNote }}</span>
  </div>
  <Notice v-if="failure && !stats" :failure="failure" @retry="retry" />
  <p v-else-if="!stats" class="admin-metric-note" aria-busy="true">Загружаем…</p>
  <p v-else-if="!latest" class="admin-metric-note">Замеров за этот период нет: сервер записывает их раз в минуту.</p>
  <template v-else>
    <Stats v-if="latest" label="Сейчас">
      <Stat label="Процессор" :dot="toneOf(latest.cpuPct)" :note="`нагрузка ${latest.load1.toFixed(2)}`">{{
        formatPercent(latest.cpuPct)
      }}</Stat>
      <Stat
        label="Память"
        :dot="toneOf(percent(latest.memUsedBytes, latest.memTotalBytes))"
        :note="`${formatBytes(latest.memUsedBytes)} из ${formatBytes(latest.memTotalBytes)}`"
        >{{ formatPercent(percent(latest.memUsedBytes, latest.memTotalBytes)) }}</Stat
      >
      <Stat
        label="Диск"
        :dot="toneOf(percent(latest.diskUsedBytes, latest.diskTotalBytes))"
        :note="`${formatBytes(latest.diskUsedBytes)} из ${formatBytes(latest.diskTotalBytes)}`"
        >{{ formatPercent(percent(latest.diskUsedBytes, latest.diskTotalBytes)) }}</Stat
      >
      <Stat label="База" dot="neutral" note="размер на диске">{{ formatBytes(latest.dbBytes) }}</Stat>
      <Stat label="Процесс API" dot="neutral" note="память процесса">{{ formatBytes(latest.apiRssBytes) }}</Stat>
      <Stat
        label="Медиасервер"
        dot="neutral"
        :note="
          latest.sfuRssBytes === null
            ? 'LiveKit не ответил'
            : `процессор ${formatPercent(latest.sfuCpuPct)}, память ${formatBytes(latest.sfuRssBytes)}`
        "
        >{{
          latest.sfuBytesIn === null
            ? '—'
            : `↓ ${mbit(mbps(latest.sfuBytesIn) ?? 0)} · ↑ ${mbit(mbps(latest.sfuBytesOut) ?? 0)}`
        }}</Stat
      >
      <Stat
        label="Видео"
        :dot="toneOf(percent(latest.videoMbpsMax, latest.videoBudgetMbps))"
        :note="
          latest.videoScreensMax === null
            ? 'нет данных'
            : `экранов ${latest.videoScreensMax}, камер ${latest.videoCamerasMax ?? 0}`
        "
        >{{
          latest.videoMbpsMax === null
            ? '—'
            : latest.videoBudgetMbps === null
              ? mbit(latest.videoMbpsMax)
              : `${oneDecimal.format(latest.videoMbpsMax)} из ${mbit(latest.videoBudgetMbps)}`
        }}</Stat
      >
      <Stat
        label="Потери медиа"
        :dot="lossTone(worse(lossIn(latest), lossOut(latest)))"
        note="к серверу / от сервера"
        >{{ `${lossText(lossIn(latest))} / ${lossText(lossOut(latest))}` }}</Stat
      >
      <Stat label="Средний ответ" dot="neutral" :note="`задержка цикла ${formatMs(latest.eventLoopP99Ms)}`">{{
        formatMs(latest.httpAvgMs)
      }}</Stat>
    </Stats>
    <div class="admin-metric-grid">
      <TimeChart v-for="chart in charts" :key="chart.title" :labels="labels" v-bind="chart" />
    </div>
  </template>
</template>
