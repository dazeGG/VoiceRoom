import { postJson } from '../net/api';
import { state } from '../core/state';
import { getDisplayName } from '../ui/names';
import { hasScreenAudio } from './screen-share';

export async function postState(): Promise<void> {
  if (!state.joined) return;
  await postJson('/api/state', {
    deafened: state.outputMuted,
    muted: state.muted,
    name: getDisplayName(),
    peerId: state.peerId,
    roomId: state.roomId,
    screen: Boolean(state.localScreenStream),
    screenAudio: hasScreenAudio(),
    screenProfileId: state.localScreenStream ? state.localScreenProfileId : '',
    screenStreamId: state.localScreenStream?.id || '',
    sessionToken: state.sessionToken,
    viewedScreenPeerId: state.viewedScreenPeerId || ''
  });
}
