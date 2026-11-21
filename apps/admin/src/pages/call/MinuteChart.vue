<script setup lang="ts">
import { computed } from 'vue';
import { seriesOf } from './verdict.ts';

const WIDTH = 720;
const HEIGHT = 96;
const PAD = 6;

interface ChartPoint {
  at: number;
  value: number | null | undefined;
}

const props = defineProps<{
  label: string;
  points: readonly ChartPoint[];
  from: number;
  to: number;
  limit: number;
  format: (value: number | null) => string;
}>();
const tone = (value: number | null) =>
  value === null || value < props.limit * 0.6 ? 'plain' : value < props.limit ? 'warning' : 'danger';

const chart = computed(() => {
  const { points, from, to, limit } = props;
  const { avg, peak } = seriesOf(points.map((point) => point.value));
  // The line of the limit always fits, and a big peak leaves room around it.
  const top = Math.max(limit * 2, (peak ?? 0) * 1.1);
  const x = (at: number) => (Math.max(0, at - from) / Math.max(1, to - from)) * WIDTH;
  const y = (value: number) => HEIGHT - PAD - (Math.min(value, top) / top) * (HEIGHT - 2 * PAD);

  const runs: string[] = [];
  let run: string[] = [];
  let lastAt: number | null = null;
  for (const point of points) {
    const value = point.value;
    if (typeof value !== 'number' || (lastAt !== null && point.at - lastAt > 90_000)) {
      if (run.length) runs.push(run.join(' '));
      run = [];
    }
    if (typeof value === 'number') {
      run.push(`${x(point.at).toFixed(1)},${y(value).toFixed(1)}`);
      lastAt = point.at;
    }
  }
  if (run.length) runs.push(run.join(' '));

  const limitY = y(limit);

  return { avg, peak, limitY, runs };
});
</script>

<template>
  <div class="admin-minute-chart">
    <div class="admin-minute-chart__head">
      <span class="admin-minute-chart__label">{{ label }}</span>
      <span class="admin-minute-chart__numbers">
        в среднем <b :class="'admin-tone--' + tone(chart.avg)">{{ format(chart.avg) }}</b> · пик
        <b :class="'admin-tone--' + tone(chart.peak)">{{ format(chart.peak) }}</b>
      </span>
    </div>
    <div class="admin-minute-chart__plot">
      <svg
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="`${label}: в среднем ${format(chart.avg)}, пик ${format(chart.peak)}`"
      >
        <line :x1="0" :x2="WIDTH" :y1="chart.limitY" :y2="chart.limitY" class="admin-minute-chart__limit" />
        <template v-for="(line, index) in chart.runs" :key="index">
          <polyline v-if="line.includes(' ')" :points="line" class="admin-minute-chart__line" />
          <circle
            v-else
            :cx="Number(line.split(',')[0])"
            :cy="Number(line.split(',')[1])"
            :r="2"
            class="admin-minute-chart__point"
          />
        </template>
      </svg>
      <span class="admin-minute-chart__limit-text" :style="{ top: (chart.limitY / HEIGHT) * 100 + '%' }">
        порог {{ format(limit) }}
      </span>
    </div>
  </div>
</template>
