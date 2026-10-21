// One line or bar series of a chart.

export interface ChartSeries {
  name: string;
  /** One value per label; null is a gap (not measured). */
  values: readonly (number | null)[];
  /** A colour token, e.g. 'var(--vr-accent)'. */
  color: string;
}
