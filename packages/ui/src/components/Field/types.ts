export interface FieldProps {
  id?: string | undefined;
  label: string;
  visuallyHiddenLabel?: boolean;
  visuallyHiddenHint?: boolean;
  optional?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}

export interface FieldControlAttrs {
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: true | undefined;
}
