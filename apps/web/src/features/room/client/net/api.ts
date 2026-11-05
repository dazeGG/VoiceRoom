import { LiveKitAdmission, LiveKitTokenBody } from '@voice-room/shared/contracts/admission';
import { api } from '@/api/client';
import { fetchRoomStatus } from '@/api/rooms';
import { preloadRuntimeConfig, resolveLiveKitUrls } from '@/platform/runtime-config';
import { state } from '../core/room-runtime.store';

/** LiveKit credentials with every URL the client may try, best first. */
export type LiveKitCredentials = LiveKitAdmission & { urls: string[] };

export async function requestLiveKitToken(input: {
  name: string;
  peerId: string;
  roomId: string;
  sessionToken: string;
}): Promise<LiveKitCredentials> {
  // The address list comes from a second request; it goes out beside the token, not after it.
  preloadRuntimeConfig();
  const admission = await api.post('/api/livekit-token', LiveKitAdmission, input, { bodySchema: LiveKitTokenBody });
  return { ...admission, urls: await resolveLiveKitUrls(admission.url) };
}

// How long "the room exists" holds for a join. The token request checks again
// on the server, so a room deleted in this window still ends in room_not_found.
const ROOM_CHECK_FRESH_MS = 30_000;
let lastRoomCheck: { roomId: string; at: number } | null = null;

/** Whether the room exists; on the way, remembers its name and avatar for the top bar. */
export async function checkRoomExists(roomId: string): Promise<boolean> {
  const status = await fetchRoomStatus(roomId);
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
