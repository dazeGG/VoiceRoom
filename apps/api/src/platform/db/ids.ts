import crypto from 'node:crypto';
export { createRoomCode as createRoomId } from '@voiceroom/shared/validation';

export function createRowId(): string {
  return crypto.randomUUID();
}
