<script lang="ts">
  // A small chart of numbers over time, drawn in SVG at the width it is given:
  // lines, or bars stacked per label. Hovering shows the values of one label.
  import type { ChartSeries } from './chart-series';

  let {
    title,
    labels,
    series,
    kind = 'line',
    format = (value: number) => formatNumber(value),
    height = 180,
    note = ''
  }: {
    title: string;
    labels: readonly string[];
    series: readonly ChartSeries[];
    kind?: 'line' | 'bar';
    format?: (value: number) => string;
    height?: number;
    note?: string;
  } = $props();

  const PAD = { top: 10, right: 12, bottom: 22, left: 44 };

  let width = $state(0);
  let hover = $state<number | null>(null);

  function formatNumber(value: number): string {
    if (Math.abs(value) >= 1000) return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
    return String(Math.round(value * 100) / 100);
  }

  /** A round top for the axis: 1, 2 or 5 times a power of ten. */
  function niceMax(value: number): number {
    if (!(value > 0)) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
    return 10 * power;
  }

  const count = $derived(labels.length);
  const plotWidth = $derived(Math.max(0, width - PAD.left - PAD.right));
  const plotHeight = $derived(Math.max(0, height - PAD.top - PAD.bottom));
  const top = $derived.by(() => {
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
    return niceMax(max);
  });
  const step = $derived(count > 1 ? plotWidth / (kind === 'bar' ? count : count - 1) : plotWidth);
  const x = (index: number) =>
    PAD.left + (kind === 'bar' ? step * (index + 0.5) : count > 1 ? step * index : plotWidth / 2);
  const y = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight;

  const paths = $derived(
    kind === 'line'
      ? series.map((line) => {
          let path = '';
          let open = false;
          line.values.forEach((value, index) => {
            if (value === null || value === undefined) {
              open = false;
              return;
            }
            path += `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
            open = true;
          });
          return path;
        })
      : []
  );

  const bars = $derived.by(() => {
    if (kind !== 'bar') return [];
    const barWidth = Math.max(1, step * 0.7);
    const out: { x: number; y: number; width: number; height: number; color: string }[] = [];
    for (let index = 0; index < count; index += 1) {
      let base = 0;
      for (const line of series) {
        const value = line.values[index] ?? 0;
        if (value <= 0) continue;
        const y0 = y(base);
        const y1 = y(base + value);
        out.push({ x: x(index) - barWidth / 2, y: y1, width: barWidth, height: y0 - y1, color: line.color });
        base += value;
      }
    }
    return out;
  });

  const ticks = $derived([0, 0.25, 0.5, 0.75, 1].map((share) => share * top));
  const labelEvery = $derived(Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / 70)))));

  function onPointerMove(event: PointerEvent): void {
    if (count === 0 || plotWidth <= 0) return;
    const box = (event.currentTarget as SVGElement).getBoundingClientRect();
    const offset = event.clientX - box.left - PAD.left;
    const index = kind === 'bar' ? Math.floor(offset / step) : Math.round(offset / (step || 1));
    hover = Math.min(count - 1, Math.max(0, index));
  }

  /** Each series at the label under the pointer. */
  const hovered = $derived.by((): { name: string; color: string; value: number | null }[] => {
    const index = hover;
    if (index === null) return [];
    return series.map((line) => ({ name: line.name, color: line.color, value: line.values[index] ?? null }));
  });

  const tooltipLeft = $derived(hover === null ? 0 : Math.min(Math.max(x(hover), 80), Math.max(80, width - 80)));
</script>

<figure class="chart">
  <figcaption class="chart-head">
    <span class="chart-title">{title}</span>
    <span class="chart-legend">
      {#each series as line (line.name)}
        <span class="chart-key"><span class="chart-dot" style:background={line.color}></span>{line.name}</span>
      {/each}
    </span>
  </figcaption>
  <div class="chart-plot" bind:clientWidth={width} style:height="{height}px">
    {#if count === 0}
      <p class="chart-empty">Пока нет данных</p>
    {:else if width > 0}
      <svg
        {width}
        {height}
        role="img"
        aria-label={title}
        onpointermove={onPointerMove}
        onpointerleave={() => (hover = null)}
      >
        {#each ticks as tick (tick)}
          <line class="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
          <text class="chart-axis" x={PAD.left - 6} y={y(tick)} text-anchor="end" dominant-baseline="middle">
            {format(tick)}
          </text>
        {/each}
        {#each labels as label, index (index)}
          {#if index % labelEvery === 0}
            <text class="chart-axis" x={x(index)} y={height - 6} text-anchor="middle">{label}</text>
          {/if}
        {/each}
        {#if kind === 'bar'}
          {#each bars as bar, index (index)}
            <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx="2" style:fill={bar.color} />
          {/each}
        {:else}
          {#each paths as path, index (index)}
            <path class="chart-line" d={path} style:stroke={series[index]?.color} />
          {/each}
        {/if}
        {#if hover !== null}
          <line class="chart-cursor" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotHeight} />
          {#if kind === 'line'}
            {#each hovered as point (point.name)}
              {#if point.value !== null}
                <circle cx={x(hover)} cy={y(point.value)} r="3" style:fill={point.color} />
              {/if}
            {/each}
          {/if}
        {/if}
      </svg>
      {#if hover !== null}
        <div class="chart-tip" style:left="{tooltipLeft}px" role="status">
          <strong>{labels[hover]}</strong>
          {#each hovered as point (point.name)}
            <span
              ><span class="chart-dot" style:background={point.color}></span>{point.name}:
              {point.value === null ? '—' : format(point.value)}</span
            >
          {/each}
        </div>
      {/if}
    {/if}
  </div>
  {#if note}<p class="chart-note">{note}</p>{/if}
</figure>

<style>
  .chart {
    display: grid;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 14px 16px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .chart-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px 12px;
  }

  .chart-title {
    color: var(--vr-text);
    font-size: 14px;
    font-weight: 600;
  }

  .chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    color: var(--vr-text-2);
    font-size: 12px;
  }

  .chart-key {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .chart-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
  }

  .chart-plot {
    position: relative;
    min-width: 0;
  }

  .chart-plot svg {
    display: block;
    overflow: visible;
    touch-action: pan-y;
  }

  .chart-grid {
    stroke: var(--vr-line);
    stroke-width: 1;
  }

  .chart-axis {
    fill: var(--vr-text-3);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .chart-line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .chart-cursor {
    stroke: var(--vr-line-strong);
    stroke-dasharray: 3 3;
  }

  .chart-tip {
    position: absolute;
    top: 0;
    display: grid;
    gap: 2px;
    min-width: 140px;
    padding: 8px 10px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 10px;
    background: var(--vr-surface-3);
    box-shadow: var(--vr-shadow-popover);
    color: var(--vr-text);
    font-size: 12px;
    pointer-events: none;
    transform: translateX(-50%);
  }

  .chart-tip span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--vr-text-2);
    font-variant-numeric: tabular-nums;
  }

  .chart-empty,
  .chart-note {
    margin: 0;
    color: var(--vr-text-3);
    font-size: 12.5px;
  }

  .chart-empty {
    display: grid;
    height: 100%;
    place-items: center;
  }
</style>
