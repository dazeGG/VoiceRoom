// A small chart of numbers over time, drawn in SVG at the width it is given:
// lines, or bars stacked per label. Hovering shows the values of one label.

import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { ChartSeries } from './chart-series.ts';
import './TimeChart.css';

const PAD = { top: 10, right: 12, bottom: 22, left: 44 };

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000) return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

/** The smallest of 1, 2 or 5 times a power of ten that is at least `value`. */
function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

/** Counts get whole-number gridlines: four equal steps of a round size. */
function countMax(value: number): number {
  return 4 * Math.max(1, niceStep(value / 4));
}

/** A round top for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

export function TimeChart({
  title,
  labels,
  series,
  kind = 'line',
  format = formatNumber,
  height = 180,
  note = ''
}: {
  title: string;
  labels: readonly string[];
  series: readonly ChartSeries[];
  kind?: 'line' | 'bar' | undefined;
  format?: ((value: number) => string) | undefined;
  height?: number | undefined;
  note?: string | undefined;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const box = plot.current;
    if (!box) return;
    const measure = () => setWidth(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const count = labels.length;
  const wholeNumbers = series.every((line) => line.values.every((value) => value === null || Number.isInteger(value)));
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
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

  const paths =
    kind === 'line'
      ? series.map((line) => {
          let path = '';
          let open = false;
          line.values.forEach((value, index) => {
            if (value === null) {
              open = false;
              return;
            }
            path += `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
            open = true;
          });
          return path;
        })
      : [];

  const bars: { x: number; y: number; width: number; height: number; color: string }[] = [];
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

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => share * top);
  const labelEvery = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / 70))));

  function onPointerMove(event: PointerEvent<SVGSVGElement>): void {
    if (count === 0 || plotWidth <= 0) return;
    const offset = event.clientX - event.currentTarget.getBoundingClientRect().left - PAD.left;
    const index = kind === 'bar' ? Math.floor(offset / step) : Math.round(offset / (step || 1));
    setHover(Math.min(count - 1, Math.max(0, index)));
  }

  /** Each series at the label under the pointer. */
  const hovered =
    hover === null
      ? []
      : series.map((line) => ({ name: line.name, color: line.color, value: line.values[hover] ?? null }));
  const tooltipLeft = hover === null ? 0 : Math.min(Math.max(x(hover), 80), Math.max(80, width - 80));

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="chart-legend">
          {series.map((line) => (
            <span key={line.name} className="chart-key">
              <span className="chart-dot" style={{ background: line.color }} />
              {line.name}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="chart-plot" ref={plot} style={{ height }}>
        {count === 0 ? (
          <p className="chart-empty">Пока нет данных</p>
        ) : width > 0 ? (
          <>
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={title}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(null)}
            >
              {ticks.map((tick) => (
                <g key={tick}>
                  <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
                  <text className="chart-axis" x={PAD.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                    {format(tick)}
                  </text>
                </g>
              ))}
              {labels.map((label, index) =>
                index % labelEvery === 0 ? (
                  <text key={index} className="chart-axis" x={x(index)} y={height - 6} textAnchor="middle">
                    {label}
                  </text>
                ) : null
              )}
              {kind === 'bar'
                ? bars.map((bar, index) => (
                    <rect
                      key={index}
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                      rx="2"
                      style={{ fill: bar.color }}
                    />
                  ))
                : paths.map((path, index) => (
                    <path key={index} className="chart-line" d={path} style={{ stroke: series[index]?.color }} />
                  ))}
              {hover !== null ? (
                <>
                  <line className="chart-cursor" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotHeight} />
                  {kind === 'line'
                    ? hovered.map((point) =>
                        point.value !== null ? (
                          <circle
                            key={point.name}
                            cx={x(hover)}
                            cy={y(point.value)}
                            r="3"
                            style={{ fill: point.color }}
                          />
                        ) : null
                      )
                    : null}
                </>
              ) : null}
            </svg>
            {hover !== null ? (
              <div className="chart-tip" style={{ left: tooltipLeft }} role="status">
                <strong>{labels[hover]}</strong>
                {hovered.map((point) => (
                  <span key={point.name}>
                    <span className="chart-dot" style={{ background: point.color }} />
                    {`${point.name}: ${point.value === null ? '—' : format(point.value)}`}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {note ? <p className="chart-note">{note}</p> : null}
    </figure>
  );
}
