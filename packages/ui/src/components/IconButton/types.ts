export interface IconButtonProps {
  label: string;
  size?: 24 | 28 | 32 | 40 | 44 | undefined;
  variant?: 'default' | 'filled' | 'outline' | 'soft' | 'primary' | 'danger' | undefined;
  tooltip?: boolean | undefined;
  shortcut?: string[] | undefined;
  disabled?: boolean | undefined;
  type?: 'button' | 'submit' | undefined;
}
