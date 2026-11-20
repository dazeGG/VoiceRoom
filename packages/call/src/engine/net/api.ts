import { getCallPorts } from '../ports';
import type { CallTransport, LiveKitCredentials } from '../transport';
import { state } from '../core/room-runtime.store';

export type { LiveKitCredentials };

export const requestLiveKitToken: CallTransport['requestLiveKitToken'] = (input) =>
  getCallPorts().transport.requestLiveKitToken(input);

// How long "the room exists" holds for a join. The token request checks again
// on the server, so a room deleted in this window still ends in room_not_found.
const ROOM_CHECK_FRESH_MS = 30_000;
let lastRoomCheck: { roomId: string; at: number } | null = null;

/** Whether the room exists; on the way, remembers its name and avatar for the top bar. */
export async function checkRoomExists(roomId: string): Promise<boolean> {
  const status = await getCallPorts().transport.roomStatus(roomId);
  if (!status) {
    lastRoomCheck = null;
    return false;
  }
  state.roomName = status.name;
  state.roomAvatarUrl = status.avatarUrl ?? '';
  state.roomIsStatic = status.isStatic;
  lastRoomCheck = { roomId, at: Date.now() };
  return true;
}

/** A join right after the room page checked the room need not ask again. */
export function roomCheckIsFresh(roomId: string): boolean {
  return lastRoomCheck?.roomId === roomId && Date.now() - lastRoomCheck.at < ROOM_CHECK_FRESH_MS;
}
