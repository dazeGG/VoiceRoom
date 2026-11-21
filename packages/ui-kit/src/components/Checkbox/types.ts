export type CheckboxValue = boolean | 'indeterminate';

export interface CheckboxProps {
  id?: string | undefined;
  description?: string | undefined;
  size?: 'sm' | 'md' | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  required?: boolean | undefined;
}
