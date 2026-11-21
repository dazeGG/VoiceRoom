export interface ProgressProps {
  label: string;
  hideLabel?: boolean;
  value?: number | null;
  size?: 'sm' | 'lg';
  error?: boolean;
}
