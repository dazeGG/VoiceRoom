// Who owns a room. Only a persistent room has an owner; a temporary room
// belongs to nobody and cannot be changed.

export function isRoomOwner(
  room: { isStatic: boolean; ownerId?: string | null } | null | undefined,
  userId: string | null | undefined
): boolean {
  return Boolean(room?.isStatic && userId && room.ownerId === userId);
}
