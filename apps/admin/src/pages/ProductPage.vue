<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type { ProductDay } from '@voice-room/shared/contracts/admin';
import { fetchProductStats } from '../api/admin.ts';
import { formatDay, formatHours } from '../format.ts';
import { PRODUCT_PRESETS, productQuery, type TimeRange } from '../time-range.ts';
import { EmptyState, Panel } from '../ui';
import TimeChart from '../charts/TimeChart.vue';
import type { ChartSeries } from '../charts/chart-series.ts';
import Notice from '../Notice.vue';
import TimeRangePicker from '../TimeRangePicker.vue';
import { useAdminResource } from '../use-admin-resource.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The spans after registration the cohort table counts returns in, by the first day each starts on. */
const RETENTION_SPANS: readonly {
  key: 'returnedWeek1Pct' | 'returnedWeek2Pct' | 'returnedMonth1Pct';
  firstDay: number;
}[] = [
  { key: 'returnedWeek1Pct', firstDay: 1 },
  { key: 'returnedWeek2Pct', firstDay: 8 },
  { key: 'returnedMonth1Pct', firstDay: 15 }
];

/** Whether a span has begun for the week's first accounts: before that its 0% means nothing yet. */
const reached = (week: string, firstDay: number, now: number) =>
  Date.parse(`${week}T00:00:00+03:00`) + firstDay * DAY_MS <= now;
const heat = (value: number) => `${6 + Math.min(1, value / 55) * 50}%`;
const now = Date.now();
const range = shallowRef<TimeRange>({ kind: 'preset', id: '30d' });
const {
  data: stats,
  failure,
  busy: loading,
  reload: retry
} = useAdminResource(() => fetchProductStats(productQuery(range.value, PRODUCT_PRESETS, Date.now())), [range], {
  failureText: 'Не удалось загрузить статистику'
});
const resolved = computed(() => {
  const answer = stats.value;
  return answer ? { from: Date.parse(`${answer.from}T12:00`), to: Date.parse(`${answer.to}T12:00`) } : null;
});
const labels = computed(() => stats.value?.days.map((day) => formatDay(day.day)) ?? []);
const trackingNote = computed(() => {
  const since = stats.value?.trackingSince;
  return since ? `Учёт идёт с ${formatDay(since)}.${since.slice(0, 4)}.` : '';
});
const charts = computed<
  { title: string; series: ChartSeries[]; kind?: 'bar'; format?: (value: number) => string; note?: string }[]
>(() => {
  const answer = stats.value;
  if (!answer) return [];
  const days = answer.days;
  const pick = (key: keyof Omit<ProductDay, 'day'>) => days.map((day) => day[key]);
  const totalAccounts = days.reduce<number[]>((totals, day) => {
    totals.push((totals.at(-1) ?? answer.accountsBefore) + day.newAccounts);
    return totals;
  }, []);
  const note = trackingNote.value;
  return [
    {
      title: 'Активные аккаунты',
      series: [
        { name: 'Всего', values: pick('activeAccounts'), color: 'var(--vr-accent)' },
        { name: 'Приложение', values: pick('desktopApp'), color: 'var(--vr-success)' },
        { name: 'Браузер', values: pick('browser'), color: 'var(--vr-info)' },
        { name: 'Телефон', values: pick('mobile'), color: 'var(--vr-warning)' }
      ],
      note: `Один аккаунт за день может зайти с нескольких клиентов. ${note}`
    },
    {
      title: 'Аккаунты',
      series: [{ name: 'Всего аккаунтов', values: totalAccounts, color: 'var(--vr-accent)' }],
      note: 'Нарастающим итогом, включая позже удалённые.'
    },
    {
      title: 'Регистрации',
      kind: 'bar',
      series: [{ name: 'Новых аккаунтов', values: pick('newAccounts'), color: 'var(--vr-accent)' }]
    },
    {
      title: 'Сообщения',
      kind: 'bar',
      series: [
        { name: 'В комнатах', values: pick('roomMessages'), color: 'var(--vr-accent)' },
        { name: 'В личке', values: pick('directMessages'), color: 'var(--vr-info)' }
      ],
      note: 'Включая удалённые позже. Гости пишут без аккаунта.'
    },
    {
      title: 'Созданные комнаты',
      kind: 'bar',
      series: [
        { name: 'Постоянные', values: pick('staticRoomsCreated'), color: 'var(--vr-accent)' },
        { name: 'Временные', values: pick('temporaryRoomsCreated'), color: 'var(--vr-warning)' }
      ]
    },
    {
      title: 'Часы в войсе',
      kind: 'bar',
      format: formatHours,
      series: [
        { name: 'Аккаунты', values: pick('voiceAccountHours'), color: 'var(--vr-success)' },
        { name: 'Гости', values: pick('voiceGuestHours'), color: 'var(--vr-warning)' }
      ],
      note: `Заход относится к дню, в который начался. ${note}`
    },
    {
      title: 'Заходы в войс',
      series: [
        { name: 'Заходов', values: pick('voiceJoins'), color: 'var(--vr-accent)' },
        { name: 'Аккаунтов в войсе', values: pick('voiceAccounts'), color: 'var(--vr-success)' }
      ]
    },
    {
      title: 'Пики онлайна за день',
      series: [
        { name: 'Аккаунтов', values: pick('peakOnline'), color: 'var(--vr-accent)' },
        { name: 'Гостей', values: pick('peakGuests'), color: 'var(--vr-warning)' },
        { name: 'В войсе', values: pick('peakVoicePeers'), color: 'var(--vr-success)' }
      ],
      note: `Наибольшее число одновременно за день, по замерам каждые 15 минут. ${note}`
    }
  ];
});
</script>

<template>
  <div class="admin-metric-toolbar">
    <TimeRangePicker
      :value="range"
      :presets="PRODUCT_PRESETS"
      :with-time="false"
      :resolved="resolved"
      @change="range = $event"
    />
    <span v-if="loading && stats" class="admin-metric-note">Обновляем…</span>
  </div>
  <Notice v-if="failure && !stats" :failure="failure" @retry="retry" />
  <p v-else-if="!stats" class="admin-metric-note" aria-busy="true">Загружаем…</p>
  <template v-else>
    <div class="admin-metric-grid">
      <TimeChart v-for="chart in charts" :key="chart.title" :labels="labels" v-bind="chart" />
    </div>
    <Panel title="Возвращаемость по неделе регистрации" flush>
      <EmptyState v-if="stats.retention.length === 0" title="Пока нет аккаунтов." compact />
      <div v-else class="admin-product__scroll" role="region" aria-label="Таблица возвращаемости" tabindex="0">
        <table class="admin-product__table">
          <thead>
            <tr>
              <th scope="col">Неделя</th>
              <th scope="col">Аккаунтов</th>
              <th scope="col">Вернулись на 1–7 день</th>
              <th scope="col">На 8–14 день</th>
              <th scope="col">На 15–30 день</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="week in stats.retention" :key="week.week">
              <th scope="row">с {{ formatDay(week.week) }}</th>
              <td class="admin-metric-mono">{{ week.accounts }}</td>
              <td v-for="span in RETENTION_SPANS" :key="span.firstDay">
                <span
                  v-if="reached(week.week, span.firstDay, now)"
                  class="admin-product__cell"
                  :style="{ '--heat': heat(week[span.key]) }"
                >
                  {{ week[span.key] }}%
                </span>
                <span v-else class="admin-product__cell admin-product__cell--pending">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="admin-product__foot admin-metric-note">
        Доля аккаунтов недели, которые снова заходили в этот промежуток после регистрации; «—» — промежуток ещё не
        наступил. {{ trackingNote }} У более ранних недель проценты занижены.
      </p>
    </Panel>
  </template>
</template>
