// The call's network level on its way to the server (room.peer.update
// `network`, see network-level.ts): its own patch on a change, so the room is
// not told of something it never sees, and again with the full peer state on
// every snapshot (presence.ts postState), so a seat the server made afresh (a
// deploy, an expired reconnect lease) hears it too.

import type { NetworkLevel } from '@voice-room/shared/contracts/rooms';
import { updateVoicePeer } from '$lib/entities/room/room-realtime';
import { state } from '../core/state.svelte';
import { createNetworkLevelTracker } from './network-level';

function postNetworkLevel(level: NetworkLevel): boolean {
  if (!state.joined) return false;
  updateVoicePeer({
    peerId: state.peerId,
    roomId: state.roomId,
    sessionToken: state.sessionToken,
    patch: { network: level }
  });
  return true;
}

const tracker = createNetworkLevelTracker(postNetworkLevel);

export const noteNetworkReading = tracker.note;
export const resetNetworkLevel = tracker.reset;
export const currentNetworkLevel = tracker.current;
