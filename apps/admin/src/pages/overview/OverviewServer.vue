<script setup lang="ts">
import { computed } from 'vue';
import type { AdminOverview, SystemStats } from '@voiceroom/shared/contracts/admin';
import { formatBytes, formatCount, formatMs, formatPercent, formatSince } from '../../format.ts';
import { Card, EmptyState } from '../../ui';
import { lossIn, lossOut, percent } from '../system-metrics.ts';

const HOUR = 60 * 60 * 1000;
const props = defineProps<{ overview: AdminOverview; system: SystemStats; now: number }>();
const latest = computed(() => props.overview.system);
const gauges = computed(() => {
  const sample = latest.value;
  if (!sample) return [];
  return [
    { label: 'Процессор', value: sample.cpuPct, detail: `нагрузка ${sample.load1.toFixed(2)}` },
    {
      label: 'Память',
      value: percent(sample.memUsedBytes, sample.memTotalBytes),
      detail: `${formatBytes(sample.memUsedBytes)} из ${formatBytes(sample.memTotalBytes)}`
    },
    {
      label: 'Диск',
      value: percent(sample.diskUsedBytes, sample.diskTotalBytes),
      detail: `${formatBytes(sample.diskUsedBytes)} из ${formatBytes(sample.diskTotalBytes)}`
    }
  ];
});
const last = computed(() => props.system.samples.at(-1));
const errors = computed(() =>
  props.system.samples.reduce((sum, sample) => sum + (sample.at > props.now - HOUR ? sample.http5xx : 0), 0)
);
const lossWorst = computed(() => (last.value ? Math.max(lossIn(last.value) ?? -1, lossOut(last.value) ?? -1) : -1));

function tone(value: number | null): string {
  if (value === null) return 'neutral';
  return value >= 90 ? 'danger' : value >= 70 ? 'warning' : 'success';
}
</script>

<template>
  <Card v-if="latest" class="admin-overview-server">
    <p class="admin-metric-note">
      Версия {{ overview.version }} · работает {{ formatSince(overview.startedAt, now) }} · замер
      {{ formatSince(latest.at, now) }} назад
    </p>
    <div
      v-for="gauge in gauges"
      :key="gauge.label"
      class="admin-overview-server__gauge"
      :class="'admin-tone--' + tone(gauge.value)"
    >
      <span class="admin-overview-server__gauge-head">
        <span>{{ gauge.label }}</span>
        <strong>{{ formatPercent(gauge.value) }}</strong>
      </span>
      <meter
        v-if="gauge.value !== null"
        class="admin-overview-server__meter"
        :aria-label="gauge.label"
        :value="Math.max(0, Math.min(100, gauge.value))"
        :aria-valuetext="formatPercent(gauge.value)"
        min="0"
        low="70"
        high="90"
        max="100"
        optimum="0"
      />
      <span v-else class="admin-overview-server__meter" aria-hidden="true" />
      <span class="admin-metric-note">{{ gauge.detail }}</span>
    </div>
    <dl class="admin-overview-server__facts">
      <div>
        <dt>Потери на LiveKit</dt>
        <dd>{{ lossWorst < 0 ? '—' : formatPercent(lossWorst) }}</dd>
      </div>
      <div>
        <dt>Задержка API</dt>
        <dd>{{ formatMs(last?.httpAvgMs ?? null) }}</dd>
      </div>
      <div>
        <dt>Ошибки 5xx за час</dt>
        <dd>{{ formatCount(errors) }}</dd>
      </div>
      <div>
        <dt>Экранов и камер</dt>
        <dd>{{ formatCount(last?.videoScreensMax ?? 0) }} · {{ formatCount(last?.videoCamerasMax ?? 0) }}</dd>
      </div>
    </dl>
  </Card>
  <Card v-else><EmptyState title="Замеров ещё нет" compact /></Card>
</template>
