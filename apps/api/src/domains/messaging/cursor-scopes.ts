// Opaque cursors are bound to a purpose and a context, so a cursor minted for
// one thread or purpose never decodes for another. Every pair lives here, for
// the history pages and for the read marks that decode the cursors those pages hand out.

import { orderedPair } from '../social/social-records.ts';

export type CursorScope = { purpose: string; context: string };

// A thread has one context whichever side reads it.
export const canonicalParticipants = orderedPair;

export const roomCursorScopes = (roomId: string) => ({
  history: { purpose: 'room-history', context: `room:${roomId}` },
  read: { purpose: 'room-read', context: `room:${roomId}` }
});

export const dmCursorScopes = (userId: string, peerId: string) => {
  const context = `dm:${canonicalParticipants(userId, peerId).join(':')}`;
  return {
    history: { purpose: 'dm-history', context },
    read: { purpose: 'dm-read', context }
  };
};
