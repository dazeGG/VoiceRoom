// A room's owner cannot leave it: the room would be left without one.

export function mayLeaveRoom(membership: { role: string } | null | undefined): boolean {
  return membership?.role !== 'owner';
}
