import type { AvatarProps } from '../Avatar/types';

export interface IncomingCallCardProps {
  caller: Pick<AvatarProps, 'name' | 'src' | 'colorKey'>;
  variant?: 'default' | 'compact';
  /** Size of the icon-only actions. Use 44 for touch layouts. */
  iconSize?: 32 | 44;
  leaveRoomName?: string | undefined;
  /** Attempt expiry as a Unix timestamp in milliseconds. */
  expiresAt: number;
  silenced?: boolean;
  state?: 'ringing' | 'accepting';
}
