import { updateVoicePeer } from '$lib/features/home/model/room-realtime';
import { state } from '../core/state.svelte';
import { getDisplayName } from '../ui/names';

function hasLocalScreenAudio(): boolean {
  return Boolean(state.localScreenStream?.getAudioTracks().some((track) => track.readyState !== 'ended'));
}

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
      screenAudio: hasLocalScreenAudio(),
      screenProfileId: state.localScreenStream ? state.localScreenProfileId : '',
      screenStreamId: state.localScreenStream?.id || '',
      viewedScreenPeerId: state.self?.viewedScreenPeerId || ''
    }
  });
}
