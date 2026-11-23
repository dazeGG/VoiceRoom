// Relief for a call the computer is straining (call-strain.ts), beside the
// lighter noise suppression: video gets lighter for the rest of the call,
// silently. Our camera stops at its 360p layer, other people's cameras come in
// at the smallest layer unless one is opened large (remote-participants.ts),
// and our screen capture requests at most 15 frames a second.

import type { LocalTrackPublication } from 'livekit-client';
import type { ProcessingRelief } from '@voiceroom/shared/contracts/rooms';
import { RELIEVED_SCREEN_FRAME_RATE } from '../core/config';
import { state } from '../core/room-runtime.store';
import { loadLiveKitClient } from '../media/livekit-runtime';
import { getScreenProfile } from '../media/profiles';
import { syncRemoteCameraDemand } from './livekit/remote-participants';
import { limitScreenCaptureFrameRate } from './screen-capture-service';

/** Our camera publication, lighter while the call is relieved. */
export async function applyVideoReliefToCamera(
  publication: LocalTrackPublication | null | undefined
): Promise<boolean> {
  const track = publication?.videoTrack;
  if (!state.videoRelieved || !track) return false;
  const { VideoQuality } = await loadLiveKitClient();
  if (publication.videoTrack !== track) return false;
  track.setPublishingQuality(VideoQuality.MEDIUM);
  return true;
}

/** Our shared screen, at most RELIEVED_SCREEN_FRAME_RATE while the call is relieved. */
export async function applyVideoReliefToScreen(stream: MediaStream | null | undefined): Promise<void> {
  await requestScreenRelief(stream);
}

async function requestScreenRelief(stream: MediaStream | null | undefined): Promise<boolean | null> {
  if (!state.videoRelieved || !stream) return null;
  return limitScreenCaptureFrameRate(stream, getScreenProfile(state.localScreenProfileId), RELIEVED_SCREEN_FRAME_RATE);
}

/** Makes the call's video lighter, once per call; the start of a call clears it (room.ts). */
export async function relieveVideo(onResult?: (result: ProcessingRelief) => void): Promise<void> {
  if (!state.joined || state.videoRelieved) return;
  state.videoRelieved = true;
  const { localCameraPublication, localScreenStream } = state;
  await Promise.all([
    Promise.all([syncRemoteCameraDemand(), applyVideoReliefToCamera(localCameraPublication)]).then(
      ([remote, local]) => {
        if (remote || local || localCameraPublication)
          onResult?.({ kind: 'video', outcome: remote || local ? 'applied' : 'failed' });
      },
      () => onResult?.({ kind: 'video', outcome: 'failed' })
    ),
    localScreenStream &&
      requestScreenRelief(localScreenStream).then(
        (applied) => {
          if (applied !== null) onResult?.({ kind: 'screen', outcome: applied ? 'applied' : 'failed' });
        },
        () => onResult?.({ kind: 'screen', outcome: 'failed' })
      )
  ]);
}
