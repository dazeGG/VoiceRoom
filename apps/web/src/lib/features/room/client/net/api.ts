import type { LiveKitAdmission } from '@voice-room/shared/contracts/admission';
import { api } from '$lib/api/client';
import { fetchRoomStatus } from '$lib/api/rooms';
import { resolveLiveKitUrls } from '$lib/platform/runtime-config';
import { state } from '../core/state.svelte';

/** LiveKit credentials with every URL the client may try, best first. */
export type LiveKitCredentials = LiveKitAdmission & { urls: string[] };

export async function requestLiveKitToken(input: {
  name: string;
  peerId: string;
  roomId: string;
  sessionToken: string;
}): Promise<LiveKitCredentials> {
  const admission = await api.post<LiveKitAdmission>('/api/livekit-token', input);
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
