import type { AvatarProps } from '../Avatar/types';

export interface FileDropProps {
  inputLabel?: string;
  accept?: string;
  multiple?: boolean;
  caption?: string;
  disabled?: boolean;
  variant?: 'dropzone' | 'avatar' | 'trigger';
  validateAccept?: boolean;
  avatar?: Pick<AvatarProps, 'name' | 'src' | 'shape' | 'colorKey'>;
}
