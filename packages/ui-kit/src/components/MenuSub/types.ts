import type { MenuItemProps } from '../MenuItem/types';

export interface MenuSubProps extends Omit<MenuItemProps, 'shortcut'> {
  ariaLabel?: string;
}
