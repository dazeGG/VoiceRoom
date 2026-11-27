export interface ProgressProps {
  label: string;
  hideLabel?: boolean;
  value?: number | null;
  size?: 'sm' | 'lg';
  /** A decorative thin track without a label or percentage. */
  variant?: 'standard' | 'track';
  error?: boolean;
}
