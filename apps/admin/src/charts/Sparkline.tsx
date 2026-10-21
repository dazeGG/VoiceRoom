// A tiny line of how a number moved, with no axes: the trend under a tile.

import './Sparkline.css';

const WIDTH = 100;

interface Point {
  x: number;
  y: number;
}

export function Sparkline({
  values,
  color = 'var(--vr-accent)',
  height = 36,
  label
}: {
  values: readonly (number | null)[];
  color?: string | undefined;
  height?: number | undefined;
  label: string;
}) {
  const known = values.filter((value): value is number => value !== null);
  const points: (Point | null)[] = [];
  if (known.length >= 2) {
    const max = Math.max(...known);
    const min = Math.min(0, ...known);
    const span = max - min || 1;
    const step = WIDTH / (values.length - 1);
    values.forEach((value, index) =>
      points.push(value === null ? null : { x: index * step, y: height - 2 - ((value - min) / span) * (height - 4) })
    );
  }

  if (points.length === 0) return <div className="spark spark--empty" style={{ height }} aria-hidden="true" />;

  const line = points
    .map((point, index) => {
      if (!point) return '';
      return `${points[index - 1] ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join('');

  const drawn = points.filter((point): point is Point => point !== null);
  const first = drawn[0];
  const last = drawn.at(-1);
  const area =
    first && last
      ? `M${first.x.toFixed(2)},${height}${drawn.map((point) => `L${point.x.toFixed(2)},${point.y.toFixed(2)}`).join('')}L${last.x.toFixed(2)},${height}Z`
      : '';

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      role="img"
      aria-label={label}
    >
      <path className="spark-area" d={area} style={{ fill: color }} />
      <path className="spark-line" d={line} style={{ stroke: color }} />
    </svg>
  );
}
