export interface NumberFieldProps {
  size?: 'sm' | 'md' | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
  readonly?: boolean | undefined;
  allowInvalid?: boolean | undefined;
}
