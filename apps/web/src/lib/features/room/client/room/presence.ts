import { updateVoicePeer } from '$lib/features/home/model/room-realtime';
import { state } from '../core/state.svelte';
import { getDisplayName } from '../ui/names';
import { isMicrophoneShownMuted } from '../core/microphone-mute';

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
      muted: isMicrophoneShownMuted(),
      name: getDisplayName(),
      screen: Boolean(state.localScreenStream),
      screenAudio: hasLocalScreenAudio(),
      screenProfileId: state.localScreenStream ? state.localScreenProfileId : '',
      screenStreamId: state.localScreenStream?.id || '',
      viewedScreenPeerId: state.self?.viewedScreenPeerId || ''
    }
  });
}
