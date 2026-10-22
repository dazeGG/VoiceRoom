import crypto from 'node:crypto';

export function createRowId(): string {
  return crypto.randomUUID();
}

export function createRoomId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
