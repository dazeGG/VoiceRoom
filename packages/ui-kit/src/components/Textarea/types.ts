export interface TextareaProps {
  variant?: 'default' | 'mono' | 'compact';
  placeholder?: string | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
  readonly?: boolean | undefined;
  maxlength?: number | undefined;
  showCount?: boolean | undefined;
}
