import { updateVoicePeer } from '$lib/features/home/model/room-realtime';
import { state } from '../core/state.svelte';
import { getDisplayName } from '../ui/names';
import { hasScreenAudio } from '../services/screen-share-service';

export async function postState(): Promise<void> {
  if (!state.joined) return;
  updateVoicePeer({
    peerId: state.peerId,
    roomId: state.roomId,
    sessionToken: state.sessionToken,
    patch: {
      deafened: state.outputMuted,
      muted: state.muted,
      name: getDisplayName(),
      screen: Boolean(state.localScreenStream),
      screenAudio: hasScreenAudio(),
      screenProfileId: state.localScreenStream ? state.localScreenProfileId : '',
      screenStreamId: state.localScreenStream?.id || '',
      viewedScreenPeerId: state.viewedScreenPeerId || ''
    }
  });
}
