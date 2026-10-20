<script lang="ts">
  // A tiny line of how a number moved, with no axes: the trend under a tile.
  let {
    values,
    color = 'var(--vr-accent)',
    height = 36,
    label
  }: { values: readonly (number | null)[]; color?: string; height?: number; label: string } = $props();

  const WIDTH = 100;

  const points = $derived.by(() => {
    const known = values.filter((value): value is number => value !== null);
    if (known.length < 2) return [];
    const max = Math.max(...known);
    const min = Math.min(0, ...known);
    const span = max - min || 1;
    const step = WIDTH / (values.length - 1);
    return values.map((value, index) =>
      value === null ? null : { x: index * step, y: height - 2 - ((value - min) / span) * (height - 4) }
    );
  });

  const line = $derived(
    points
      .map((point, index) => {
        if (!point) return '';
        const previous = points[index - 1];
        return `${previous ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
      })
      .join('')
  );

  const area = $derived.by(() => {
    const known = points.filter((point): point is { x: number; y: number } => point !== null);
    const first = known[0];
    const last = known.at(-1);
    if (known.length < 2 || !first || !last) return '';
    const top = known.map((point) => `L${point.x.toFixed(2)},${point.y.toFixed(2)}`).join('');
    return `M${first.x.toFixed(2)},${height}${top}L${last.x.toFixed(2)},${height}Z`;
  });
</script>

{#if points.length > 0}
  <svg
    class="spark"
    viewBox="0 0 {WIDTH} {height}"
    preserveAspectRatio="none"
    style:height="{height}px"
    role="img"
    aria-label={label}
  >
    <path class="spark-area" d={area} style:fill={color} />
    <path class="spark-line" d={line} style:stroke={color} />
  </svg>
{:else}
  <div class="spark spark--empty" style:height="{height}px" aria-hidden="true"></div>
{/if}

<style>
  .spark {
    display: block;
    width: 100%;
    overflow: visible;
  }

  .spark-area {
    opacity: 0.14;
  }

  .spark-line {
    fill: none;
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .spark--empty {
    border-bottom: 1px dashed var(--vr-line);
  }
</style>
