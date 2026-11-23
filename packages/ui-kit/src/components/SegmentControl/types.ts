export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Shows an accent dot, e.g. unread messages behind a tab. */
  dot?: boolean;
  count?: number;
}

export interface SegmentControlProps<T extends string> {
  layout?: 'equal' | 'responsive';
  options: SegmentOption<T>[];
  value: T;
  ariaLabel: string;
  /** `tabs` for panel switchers, `radio` for choosing a setting. */
  kind?: 'tabs' | 'radio';
  size?: 'sm' | 'md';
}

export interface ControlGroupProps {
  label: string;
}
