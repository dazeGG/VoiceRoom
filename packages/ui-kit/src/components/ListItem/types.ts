import type { AvatarProps } from '../Avatar/types';

export interface ListItemProps {
  text?: string;
  caption?: string;
  time?: string;
  dateTime?: string;
  avatar?: Omit<AvatarProps, 'size'>;
  dense?: boolean;
  interactive?: boolean;
  disabled?: boolean;
  /**
   * The row is the current one of its list, such as the open conversation:
   * `aria-current="true"` on the row and the selected background. For rows a
   * person picks a value from, use a Listbox instead.
   */
  selected?: boolean;
}
