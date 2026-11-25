export interface BadgeProps {
  count?: number;
  /** Spoken label for a status or an exact count, including counts displayed as 99+. */
  label?: string;
  size?: 'sm' | 'md';
  tone?: 'accent' | 'muted' | 'danger' | 'warning' | 'soft' | 'online';
  variant?: 'pill' | 'dot';
  ring?: boolean;
}
