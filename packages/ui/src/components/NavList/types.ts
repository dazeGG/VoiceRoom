export interface NavListProps {
  label: string;
}

export interface NavListGroupProps {
  label?: string;
}

export interface NavListItemProps {
  label: string;
  href?: string;
  /** A location accepted by the host application's RouterLink. */
  to?: string | object;
  current?: boolean | undefined;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}
