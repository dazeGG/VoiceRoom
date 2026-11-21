export interface TabOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  dot?: boolean;
  error?: boolean;
  disabled?: boolean;
  /** ID overrides for panels owned by another component. */
  id?: string | undefined;
  panelId?: string | undefined;
}

export interface TabsProps<T extends string> {
  items: readonly TabOption<T>[];
  label: string;
  variant?: 'line' | 'segmented';
  stretch?: boolean;
}

export interface TabPanelProps {
  /** Omit for a panel mounted outside its Tabs, and supply aria-labelledby. */
  value?: string;
}
