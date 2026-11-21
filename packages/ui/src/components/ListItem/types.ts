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
}
