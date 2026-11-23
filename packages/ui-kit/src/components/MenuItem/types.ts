export type MenuTone = 'default' | 'friendly' | 'danger';

export interface MenuItemProps {
  label: string;
  description?: string | undefined;
  shortcut?: string | undefined;
  disabled?: boolean;
  tone?: MenuTone;
}
