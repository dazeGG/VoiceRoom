export interface ComboboxOption {
  value: string;
  label: string;
  description?: string | undefined;
  searchText?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  label: string;
  options: readonly ComboboxOption[];
  size?: 'sm' | 'md' | 'lg';
  placeholder?: string;
  autoFocus?: boolean;
}
