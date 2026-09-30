// What saving room settings does to the room's avatar, chosen in RoomAvatarField.

import { deleteRoomAvatar, uploadRoomAvatar } from '$lib/api/rooms';

export type RoomAvatarChange = { kind: 'keep' } | { kind: 'upload'; image: Blob } | { kind: 'remove' };

/** Applies a change on save; answers the updated room, or null when nothing changed. */
export function saveRoomAvatarChange(roomId: string, change: RoomAvatarChange) {
  if (change.kind === 'upload') return uploadRoomAvatar(roomId, change.image);
  if (change.kind === 'remove') return deleteRoomAvatar(roomId);
  return Promise.resolve(null);
}
