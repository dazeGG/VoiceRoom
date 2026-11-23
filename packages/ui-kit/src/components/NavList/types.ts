export interface NavListProps {
  responsive?: boolean;
  label: string;
}

export interface NavListGroupProps {
  label?: string;
}

export interface NavListItemProps {
  iconOnly?: boolean;
  label: string;
  href?: string;
  /** A location accepted by the host application's RouterLink. */
  to?: string | object;
  current?: boolean | undefined;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}
