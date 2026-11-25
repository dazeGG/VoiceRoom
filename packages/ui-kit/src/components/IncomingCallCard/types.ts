import type { AvatarProps } from '../Avatar/types';

export interface IncomingCallCardProps {
  caller: Pick<AvatarProps, 'name' | 'src' | 'colorKey'>;
  variant?: 'default' | 'compact';
  leaveRoomName?: string | undefined;
  /** Attempt expiry as a Unix timestamp in milliseconds. */
  expiresAt: number;
  silenced?: boolean;
  state?: 'ringing' | 'accepting';
}
