// One number of a person's voice, minute by minute over the whole call, against
// the line where it stops being fine. A gap in the line is a minute they were
// not there or said nothing of it.

import type { ReactNode } from 'react';
import { seriesOf } from './verdict.ts';

const WIDTH = 720;
const HEIGHT = 96;
const PAD = 6;

export interface ChartPoint {
  at: number;
  value: number | null | undefined;
}

export function MinuteChart({
  label,
  points,
  from,
  to,
  limit,
  format
}: {
  label: string;
  points: readonly ChartPoint[];
  from: number;
  to: number;
  limit: number;
  format: (value: number | null) => string;
}): ReactNode {
  const { avg, peak } = seriesOf(points.map((point) => point.value));
  // The line of the limit always fits, and a big peak leaves room around it.
  const top = Math.max(limit * 2, (peak ?? 0) * 1.1);
  const x = (at: number) => (Math.max(0, at - from) / Math.max(1, to - from)) * WIDTH;
  const y = (value: number) => HEIGHT - PAD - (Math.min(value, top) / top) * (HEIGHT - 2 * PAD);
  const tone = (value: number | null) =>
    value === null || value < limit * 0.6 ? 'plain' : value < limit ? 'warning' : 'danger';

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
  return (
    <div className="minute-chart">
      <div className="minute-chart-head">
        <span className="minute-chart-label">{label}</span>
        <span className="minute-chart-numbers">
          в среднем <b data-tone={tone(avg)}>{format(avg)}</b> · пик <b data-tone={tone(peak)}>{format(peak)}</b>
        </span>
      </div>
      <div className="minute-chart-plot">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label}: в среднем ${format(avg)}, пик ${format(peak)}`}
        >
          <line x1={0} x2={WIDTH} y1={limitY} y2={limitY} className="minute-chart-limit" />
          {runs.map((line) =>
            line.includes(' ') ? (
              <polyline key={line} points={line} className="minute-chart-line" />
            ) : (
              <circle
                key={line}
                cx={Number(line.split(',')[0])}
                cy={Number(line.split(',')[1])}
                r={2}
                className="minute-chart-point"
              />
            )
          )}
        </svg>
        <span className="minute-chart-limit-text" style={{ top: `${(limitY / HEIGHT) * 100}%` }}>
          порог {format(limit)}
        </span>
      </div>
    </div>
  );
}
