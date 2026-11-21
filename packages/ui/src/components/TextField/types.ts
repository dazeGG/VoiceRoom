import type { InputHTMLAttributes } from 'vue';

export interface TextFieldProps {
  size?: 'sm' | 'md' | 'lg' | undefined;
  variant?: 'default' | 'mono' | undefined;
  type?: InputHTMLAttributes['type'];
  placeholder?: string | undefined;
  autocomplete?: string | undefined;
  inputmode?: InputHTMLAttributes['inputmode'];
  name?: string | undefined;
  disabled?: boolean | undefined;
  readonly?: boolean | undefined;
  clearable?: boolean | undefined;
}
