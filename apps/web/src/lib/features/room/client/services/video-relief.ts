// The second step when the computer stays overloaded (cpu-pressure.ts), after
// the lighter noise suppression: video gets lighter for the rest of the call,
// silently. Our camera stops at its 360p layer, other people's cameras come in
// at the smallest layer unless one is opened large (remote-participants.ts),
// and our screen share sends at most 30 frames a second.

import type { LocalTrackPublication } from 'livekit-client';
import { RELIEVED_SCREEN_FRAME_RATE } from '../core/config';
import { state } from '../core/state.svelte';
import { loadLiveKitClient } from '../media/livekit-runtime';
import { syncRemoteCameraDemand } from './livekit/remote-participants';
import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:cpu');

/** What the relief needs of a shared screen: its video tracks' rate and a way to cap it. */
type ScreenCapture = { getVideoTracks(): Pick<MediaStreamTrack, 'getSettings' | 'applyConstraints'>[] };

/** Our camera publication, lighter while the call is relieved. */
export async function applyVideoReliefToCamera(publication: LocalTrackPublication | null | undefined): Promise<void> {
  if (!state.videoRelieved || !publication) return;
  const { VideoQuality } = await loadLiveKitClient();
  publication.videoTrack?.setPublishingQuality(VideoQuality.MEDIUM);
}

/** Our shared screen, at most RELIEVED_SCREEN_FRAME_RATE while the call is relieved. */
export async function applyVideoReliefToScreen(stream: ScreenCapture | null | undefined): Promise<void> {
  if (!state.videoRelieved || !stream) return;
  for (const track of stream.getVideoTracks()) {
    const frameRate = track.getSettings().frameRate;
    if (frameRate !== undefined && frameRate <= RELIEVED_SCREEN_FRAME_RATE) continue;
    // A capture that cannot take the constraint (the desktop app's native one) keeps its rate.
    await track.applyConstraints({ frameRate: { max: RELIEVED_SCREEN_FRAME_RATE } }).catch((error: unknown) => {
      log.info('screen frame rate kept', errorContext(error));
    });
  }
}

/** Makes the call's video lighter, once per call; the start of a call clears it (room.ts). */
export async function relieveVideo(): Promise<void> {
  if (!state.joined || state.videoRelieved) return;
  state.videoRelieved = true;
  syncRemoteCameraDemand();
  await Promise.all([
    applyVideoReliefToCamera(state.localCameraPublication),
    applyVideoReliefToScreen(state.localScreenStream)
  ]);
}
