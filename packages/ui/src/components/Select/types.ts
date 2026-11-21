import type { PopoverPlacement } from '../Popover/types';

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectSize = 'sm' | 'md' | 'lg';
export type SelectVariant = 'default' | 'ghost';

/** The chosen value is the component's `v-model`; `valueChange` fires only when the user picks a different option. */
export type SelectProps = {
  options?: SelectOption[] | undefined;
  label?: string | undefined;
  disabled?: boolean | undefined;
  placement?: PopoverPlacement | undefined;
  flip?: boolean | undefined;
  size?: SelectSize | undefined;
  variant?: SelectVariant | undefined;
};
