import type { AvatarProps } from '../Avatar/types';

export interface FileDropProps {
  accept?: string;
  multiple?: boolean;
  caption?: string;
  disabled?: boolean;
  variant?: 'dropzone' | 'avatar';
  avatar?: Pick<AvatarProps, 'name' | 'src' | 'shape' | 'colorKey'>;
}
