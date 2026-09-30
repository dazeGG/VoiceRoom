// Who wrote a room message and who may change it. An account message belongs
// to its account; a guest message to the peer that wrote it (the service
// still checks that the peer session is live). Editing belongs to the author
// alone, even in a persistent room; deleting also to the room's owner.

import { isRoomOwner } from '../rooms/room.policy.ts';

type Message = { authorUserId?: string | null; peerId: string };
type Caller = { userId?: string | null; peerId?: string | null };

/** How the caller wrote the message: as its account, as its guest peer, or not at all. */
export function roomMessageAuthorship(message: Message, caller: Caller): 'account' | 'peer' | null {
  if (message.authorUserId) return caller.userId && caller.userId === message.authorUserId ? 'account' : null;
  return caller.peerId && caller.peerId === message.peerId ? 'peer' : null;
}

/** Whether the caller may delete the message without being its author. */
export function mayModerateRoomMessage(
  room: { isStatic: boolean; ownerId?: string | null },
  userId: string | null | undefined
): boolean {
  return isRoomOwner(room, userId);
}
