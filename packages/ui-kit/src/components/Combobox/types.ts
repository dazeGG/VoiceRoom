export interface ComboboxOption {
  value: string;
  label: string;
  description?: string | undefined;
  searchText?: string;
  disabled?: boolean;
  group?: string;
}

export interface ComboboxProps {
  label: string;
  options: readonly ComboboxOption[];
  size?: 'sm' | 'md' | 'lg';
  placeholder?: string;
  autoFocus?: boolean;
  /** Options are already filtered by the caller. Bind the input with v-model:query. */
  visuallyHiddenLabel?: boolean;
  overlay?: boolean;
  externalFilter?: boolean;
  loading?: boolean;
  resultsLabel?: string;
}
