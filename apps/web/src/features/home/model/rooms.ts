import type { OwnedRoom } from '@/api/auth';

export function roomDisplayName(room: OwnedRoom): string {
  return room.name?.trim() || room.roomId;
}
