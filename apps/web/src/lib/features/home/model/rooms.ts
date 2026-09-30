import type { OwnedRoom } from '$lib/api/auth';

export function roomDisplayName(room: OwnedRoom): string {
  return room.name?.trim() || room.roomId;
}
