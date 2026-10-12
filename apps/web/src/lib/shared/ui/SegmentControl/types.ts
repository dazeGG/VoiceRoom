import type { Snippet } from 'svelte';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Shows an accent dot, e.g. unread messages behind a tab. */
  dot?: boolean;
  /** Extra content after the label, e.g. a count. */
  suffix?: Snippet;
}

export interface SegmentControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** `tabs` for panel switchers, `radio` for choosing a setting. */
  kind?: 'tabs' | 'radio';
  size?: 'sm' | 'md';
  class?: string;
}
