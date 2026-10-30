import type { PopoverPlacement } from '../Popover/types';

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectVariant = 'field' | 'home' | 'compact' | 'dock';

/** The chosen value is the component's `v-model`; `valueChange` fires only when the user picks a different option. */
export type SelectProps = {
  options?: SelectOption[];
  label?: string;
  disabled?: boolean;
  placement?: PopoverPlacement;
  flip?: boolean;
  variant?: SelectVariant;
};
