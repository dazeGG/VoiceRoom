export type MenuTone = 'default' | 'friendly' | 'danger' | 'accent';

export interface MenuItemProps {
  label: string;
  description?: string | undefined;
  /** Short trailing context, separate from typeahead text and keyboard shortcuts. */
  hint?: string | undefined;
  shortcut?: string | undefined;
  disabled?: boolean;
  tone?: MenuTone;
}
