import crypto from 'node:crypto';
import { AVATAR_COLOR_KEYS } from '@voice-room/shared/validation';

/** The avatar colour a guest peer id always gets, until they choose one. */
export function avatarColorForPeerId(peerId: unknown): string {
  const digest = crypto
    .createHash('sha256')
    .update(typeof peerId === 'string' ? peerId : '')
    .digest();
  return AVATAR_COLOR_KEYS[(digest[0] as number) % AVATAR_COLOR_KEYS.length] as string;
}
