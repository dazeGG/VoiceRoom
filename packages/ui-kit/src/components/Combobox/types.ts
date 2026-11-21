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
  visuallyHiddenLabel?: boolean;
  overlay?: boolean;
  /** Keep the results visible and let the host handle dismissal. */
  inline?: boolean;
  /** Options are already filtered by the caller. Bind the input with v-model:query. */
  externalFilter?: boolean;
  loading?: boolean;
  resultsLabel?: string;
}
