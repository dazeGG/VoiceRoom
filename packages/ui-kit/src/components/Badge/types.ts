export interface BadgeProps {
  count?: number;
  size?: 'sm' | 'md';
  tone?: 'accent' | 'muted' | 'danger' | 'warning' | 'soft';
  variant?: 'pill' | 'dot';
  ring?: boolean;
}
