// Relief for a call the computer is straining (call-strain.ts), beside the
// lighter noise suppression: video gets lighter for the rest of the call,
// silently. Our camera stops at its 360p layer, other people's cameras come in
// at the smallest layer unless one is opened large (remote-participants.ts),
// and our screen capture requests at most 15 frames a second.

import type { LocalTrackPublication } from 'livekit-client';
import { RELIEVED_SCREEN_FRAME_RATE } from '../core/config';
import { state } from '../core/room-runtime.store';
import { loadLiveKitClient } from '../media/livekit-runtime';
import { getScreenProfile } from '../media/profiles';
import { syncRemoteCameraDemand } from './livekit/remote-participants';
import { limitScreenCaptureFrameRate } from './screen-capture-service';

/** Our camera publication, lighter while the call is relieved. */
export async function applyVideoReliefToCamera(publication: LocalTrackPublication | null | undefined): Promise<void> {
  if (!state.videoRelieved || !publication) return;
  const { VideoQuality } = await loadLiveKitClient();
  publication.videoTrack?.setPublishingQuality(VideoQuality.MEDIUM);
}

/** Our shared screen, at most RELIEVED_SCREEN_FRAME_RATE while the call is relieved. */
export async function applyVideoReliefToScreen(stream: MediaStream | null | undefined): Promise<void> {
  if (!state.videoRelieved || !stream) return;
  await limitScreenCaptureFrameRate(stream, getScreenProfile(state.localScreenProfileId), RELIEVED_SCREEN_FRAME_RATE);
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
