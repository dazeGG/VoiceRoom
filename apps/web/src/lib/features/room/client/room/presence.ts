import { updateVoicePeer } from '$lib/entities/room/room-realtime';
import { state } from '../core/state.svelte';
import { getDisplayName } from '../ui/names';
import { isMicrophoneShownMuted } from '../core/microphone-mute';
import { currentNetworkLevel } from './network-report';

function hasLocalScreenAudio(): boolean {
  return Boolean(state.localScreenStream?.getAudioTracks().some((track) => track.readyState !== 'ended'));
}

export async function postState(): Promise<void> {
  if (!state.joined) return;
  const network = currentNetworkLevel();
  updateVoicePeer({
    peerId: state.peerId,
    roomId: state.roomId,
    sessionToken: state.sessionToken,
    patch: {
      camera: Boolean(state.localCameraStream),
      deafened: state.outputMuted,
      muted: isMicrophoneShownMuted(),
      name: getDisplayName(),
      screen: Boolean(state.localScreenStream),
      screenAudio: hasLocalScreenAudio(),
      screenProfileId: state.localScreenStream ? state.localScreenProfileId : '',
      screenStreamId: state.localScreenStream?.id || '',
      viewedScreenPeerId: state.self?.viewedScreenPeerId || '',
      // A seat made afresh after a deploy hears the network again with the rest.
      ...(network ? { network } : {})
    }
  });
}
