<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import { formatChartNumber, type ChartSeries } from './chart-series.ts';

const PAD = { top: 10, right: 12, bottom: 22, left: 44 };

/** The smallest of 1, 2 or 5 times a power of ten that is at least `value`. */
function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

/** Counts get whole-number gridlines: two equal steps of a round size. */
function countMax(value: number): number {
  return 2 * Math.max(1, niceStep(value / 2));
}

const X_LABELS = 5;

/** Up to five labels spread evenly from the first to the last. */
function labelIndexes(count: number): Set<number> {
  if (count <= X_LABELS) return new Set(Array.from({ length: count }, (_, index) => index));
  return new Set(Array.from({ length: X_LABELS }, (_, k) => Math.round((k * (count - 1)) / (X_LABELS - 1))));
}

function lastValue(values: readonly (number | null)[]): number | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/** A round top for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

const props = withDefaults(
  defineProps<{
    title: string;
    labels: readonly string[];
    series: readonly ChartSeries[];
    kind?: 'line' | 'bar' | undefined;
    format?: ((value: number) => string) | undefined;
    height?: number | undefined;
    note?: string | undefined;
  }>(),
  { kind: 'line', format: formatChartNumber, height: 180, note: '' }
);

const plot = useTemplateRef<HTMLDivElement>('plot');
const width = ref(0);
const hover = ref<number | null>(null);
let observer: ResizeObserver | undefined;
onMounted(() => {
  const box = plot.value;
  if (!box) return;
  const measure = () => {
    width.value = box.clientWidth;
  };
  measure();
  observer = new ResizeObserver(measure);
  observer.observe(box);
});
onBeforeUnmount(() => observer?.disconnect());

const legend = computed(() => props.series.map((line) => ({ ...line, latest: lastValue(line.values) })));
const chart = computed(() => {
  const { kind, labels, series, height } = props;
  const w = width.value;
  const count = labels.length;
  const wholeNumbers = series.every((line) => line.values.every((value) => value === null || Number.isInteger(value)));
  const plotWidth = Math.max(0, w - PAD.left - PAD.right);
  const plotHeight = Math.max(0, height - PAD.top - PAD.bottom);

  let max = 0;
  for (let index = 0; index < count; index += 1) {
    if (kind === 'bar') {
      let sum = 0;
      for (const line of series) sum += line.values[index] ?? 0;
      max = Math.max(max, sum);
    } else {
      for (const line of series) max = Math.max(max, line.values[index] ?? 0);
    }
  }
  const top = wholeNumbers ? countMax(max) : niceMax(max);

  const step = count > 1 ? plotWidth / (kind === 'bar' ? count : count - 1) : plotWidth;
  const x = (index: number) =>
    PAD.left + (kind === 'bar' ? step * (index + 0.5) : count > 1 ? step * index : plotWidth / 2);
  const y = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight;

  /** Each unbroken run of a series as its points; a gap starts a new run. */
  const runsOf = (values: readonly (number | null)[]) => {
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] | null = null;
    values.forEach((value, index) => {
      if (value === null) {
        run = null;
        return;
      }
      if (!run) {
        run = [];
        runs.push(run);
      }
      run.push({ x: x(index), y: y(value) });
    });
    return runs;
  };
  const point = (at: { x: number; y: number }) => `${at.x.toFixed(1)},${at.y.toFixed(1)}`;

  const paths =
    kind === 'line'
      ? series.map((line) =>
          runsOf(line.values)
            .map((run) => run.map((at, index) => `${index ? 'L' : 'M'}${point(at)}`).join(''))
            .join('')
        )
      : [];
  // The first series sits over a faint fill down to the axis.
  const firstSeries = series[0];
  const area =
    kind === 'line' && firstSeries
      ? runsOf(firstSeries.values)
          .filter((run) => run.length > 1)
          .map((run) => {
            const first = run[0];
            const last = run.at(-1);
            if (!first || !last) return '';
            const base = y(0).toFixed(1);
            return `M${first.x.toFixed(1)},${base}${run.map((at) => `L${point(at)}`).join('')}L${last.x.toFixed(1)},${base}Z`;
          })
          .join('')
      : '';

  const bars: { x: number; y: number; width: number; height: number; color: ChartSeries['color'] }[] = [];
  if (kind === 'bar') {
    const barWidth = Math.max(1, step * 0.7);
    for (let index = 0; index < count; index += 1) {
      let base = 0;
      for (const line of series) {
        const value = line.values[index] ?? 0;
        if (value <= 0) continue;
        const y0 = y(base);
        const y1 = y(base + value);
        bars.push({ x: x(index) - barWidth / 2, y: y1, width: barWidth, height: y0 - y1, color: line.color });
        base += value;
      }
    }
  }

  const ticks = [0, 0.5, 1].map((share) => share * top);
  const shownLabels = labelIndexes(count);

  return {
    count,
    plotWidth,
    plotHeight,
    step,
    x,
    y,
    paths,
    firstSeries,
    area,
    bars,
    ticks,
    marks: labels.flatMap((label, index) => (shownLabels.has(index) ? [{ label, index }] : []))
  };
});

function onPointerMove(event: PointerEvent): void {
  const { count, plotWidth, step } = chart.value;
  if (count === 0 || plotWidth <= 0 || !(event.currentTarget instanceof SVGSVGElement)) return;
  const offset = event.clientX - event.currentTarget.getBoundingClientRect().left - PAD.left;
  const index = props.kind === 'bar' ? Math.floor(offset / step) : Math.round(offset / (step || 1));
  hover.value = Math.min(count - 1, Math.max(0, index));
}

const hovered = computed(() => {
  const index = hover.value;
  if (index === null || index >= chart.value.count) return null;
  const x = chart.value.x(index);
  return {
    x,
    label: props.labels[index],
    left: Math.min(Math.max(x, 80), Math.max(80, width.value - 80)),
    points: props.series.map((line) => ({ name: line.name, color: line.color, value: line.values[index] ?? null }))
  };
});
</script>

<template>
  <figure class="admin-chart">
    <figcaption class="admin-chart__head">
      <span class="admin-chart__title">{{ title }}</span>
      <span class="admin-chart__legend">
        <span v-for="line in legend" :key="line.name" class="admin-chart__key">
          <span class="admin-chart__swatch" :style="{ '--chart-series-color': line.color }" />
          <span>{{ line.name }}</span>
          <span v-if="line.latest !== null" class="admin-chart__value">{{ format(line.latest) }}</span>
        </span>
      </span>
    </figcaption>
    <div ref="plot" class="admin-chart__plot" :style="{ height: height + 'px' }">
      <p v-if="chart.count === 0" class="admin-chart__empty">Пока нет данных</p>
      <template v-else-if="width > 0">
        <svg
          :width="width"
          :height="height"
          role="img"
          :aria-label="title"
          @pointermove="onPointerMove"
          @pointerleave="hover = null"
        >
          <g v-for="tick in chart.ticks" :key="tick">
            <line
              class="admin-chart__grid"
              :x1="PAD.left"
              :x2="width - PAD.right"
              :y1="chart.y(tick)"
              :y2="chart.y(tick)"
            />
            <text
              class="admin-chart__axis"
              :x="PAD.left - 6"
              :y="chart.y(tick)"
              text-anchor="end"
              dominant-baseline="middle"
            >
              {{ format(tick) }}
            </text>
          </g>
          <text
            v-for="{ label, index } in chart.marks"
            :key="index"
            class="admin-chart__axis"
            :x="chart.x(index)"
            :y="height - 6"
            text-anchor="middle"
          >
            {{ label }}
          </text>
          <template v-if="kind === 'bar'">
            <rect
              v-for="(bar, index) in chart.bars"
              :key="index"
              :x="bar.x"
              :y="bar.y"
              :width="bar.width"
              :height="bar.height"
              rx="2"
              :fill="bar.color"
            />
          </template>
          <template v-else>
            <path
              v-if="chart.area && chart.firstSeries"
              class="admin-chart__area"
              :d="chart.area"
              :fill="chart.firstSeries.color"
            />
            <path
              v-for="(path, index) in chart.paths"
              :key="index"
              class="admin-chart__line"
              :class="{ 'admin-chart__line--dashed': series[index]?.dashed }"
              :d="path"
              :stroke="series[index]?.color"
            />
          </template>
          <template v-if="hovered">
            <line
              class="admin-chart__cursor"
              :x1="hovered.x"
              :x2="hovered.x"
              :y1="PAD.top"
              :y2="PAD.top + chart.plotHeight"
            />
            <template v-if="kind === 'line'">
              <template v-for="point in hovered.points" :key="point.name">
                <circle
                  v-if="point.value !== null"
                  :cx="hovered.x"
                  :cy="chart.y(point.value)"
                  r="3"
                  :fill="point.color"
                />
              </template>
            </template>
          </template>
        </svg>
        <div v-if="hovered" class="admin-chart__tip" :style="{ left: hovered.left + 'px' }" role="status">
          <strong>{{ hovered.label }}</strong>
          <span v-for="point in hovered.points" :key="point.name">
            <span class="admin-chart__dot" :style="{ '--chart-series-color': point.color }" />
            {{ `${point.name}: ${point.value === null ? '—' : format(point.value)}` }}
          </span>
        </div>
      </template>
    </div>
    <p v-if="note" class="admin-chart__note">{{ note }}</p>
  </figure>
</template>
