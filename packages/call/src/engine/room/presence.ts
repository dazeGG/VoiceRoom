import { getCallPorts } from '../ports';
import { state } from '../core/room-runtime.store';
import { getDisplayName } from '../ui/names';
import { isMicrophoneShownMuted } from '../core/microphone-mute';

function hasLocalScreenAudio(): boolean {
  return Boolean(state.localScreenStream?.getAudioTracks().some((track) => track.readyState !== 'ended'));
}

export async function postState(): Promise<void> {
  if (!state.joined) return;
  getCallPorts().transport.realtime.updatePeer({
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
      viewedScreenPeerId: state.self?.viewedScreenPeerId || ''
    }
  });
}
