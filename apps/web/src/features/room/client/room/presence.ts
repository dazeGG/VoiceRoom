import { updateVoicePeer } from '@/entities/room/room-realtime';
import { state } from '../core/room-runtime.store';
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
