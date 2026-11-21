export interface TagProps {
  size?: 'sm' | 'md';
  variant?: 'default' | 'reaction';
  emoji?: string;
  count?: number;
  label?: string;
  selectable?: boolean;
  removable?: boolean;
  disabled?: boolean;
}

export interface TagCountProps {
  count: number;
  label: string;
}
