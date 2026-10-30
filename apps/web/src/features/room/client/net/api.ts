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

/** Whether the room exists; on the way, remembers its name and avatar for the top bar. */
export async function checkRoomExists(roomId: string): Promise<boolean> {
  const status = await fetchRoomStatus(roomId);
  if (!status) return false;
  state.roomName = status.name;
  state.roomAvatarUrl = status.avatarUrl ?? '';
  state.roomIsStatic = status.isStatic;
  return true;
}
