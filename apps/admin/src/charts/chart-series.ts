// One line or bar series of a chart.

export interface ChartSeries {
  name: string;
  /** One value per label; null is a gap (not measured). */
  values: readonly (number | null)[];
  /** A colour token, e.g. 'var(--vr-accent)'. */
  color: string;
  /** A dashed line: a limit (the whole capacity) rather than a measurement. */
  dashed?: boolean | undefined;
}

export function formatChartNumber(value: number): string {
  if (Math.abs(value) >= 1000) return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}
