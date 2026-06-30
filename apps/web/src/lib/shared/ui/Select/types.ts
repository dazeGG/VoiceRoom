import type { PopoverPlacement } from '../Popover/types';

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectVariant = 'field' | 'home' | 'compact' | 'dock';

export type SelectProps = {
  value?: string;
  options?: SelectOption[];
  label?: string;
  disabled?: boolean;
  placement?: PopoverPlacement;
  flip?: boolean;
  variant?: SelectVariant;
  onValueChange?: (value: string) => void;
};
