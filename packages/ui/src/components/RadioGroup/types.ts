export interface RadioOption {
  value: string;
  label: string;
  description?: string | undefined;
  disabled?: boolean | undefined;
}

export interface RadioGroupProps {
  options?: readonly RadioOption[] | undefined;
  variant?: 'list' | 'card' | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  required?: boolean | undefined;
}

export interface RadioGroupItemProps {
  option: RadioOption;
  variant?: RadioGroupProps['variant'];
}
