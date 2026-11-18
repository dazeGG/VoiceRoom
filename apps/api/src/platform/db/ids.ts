import crypto from 'node:crypto';
export { createRoomCode as createRoomId } from '@voice-room/shared/validation';

export function createRowId(): string {
  return crypto.randomUUID();
}
