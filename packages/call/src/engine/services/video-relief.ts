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
): Promise<boolean | null> {
  if (!state.videoRelieved || !publication) return null;
  const track = publication.videoTrack;
  const sender = track?.sender;
  if (!sender) return false;
  const { getBrowser } = await loadLiveKitClient();
  if (publication.videoTrack !== track || track.sender !== sender) return false;

  // Camera publishing uses H.264 or VP8 simulcast. LiveKit's quality setter
  // returns before the sender update can succeed or fail. Its RIDs are q/h/f.
  const parameters = sender.getParameters();
  const high = parameters.encodings?.find((encoding) => encoding.rid === 'f');
  const lower = parameters.encodings?.filter((encoding) => encoding.rid === 'h' || encoding.rid === 'q');
  if (!high || !lower?.length) return false;
  if (high.active === false) return null;
  const previousBitrate = high.maxBitrate;
  high.active = false;
  for (const encoding of lower) encoding.active = true;
  const firefox = getBrowser()?.name === 'Firefox';
  if (firefox) {
    // Keep the SDK's throttling fallback for Firefox's active flag.
    high.scaleResolutionDownBy = 4;
    high.maxBitrate = 10;
    high.maxFramerate = 2;
  }
  await sender.setParameters(parameters);
  if (publication.videoTrack !== track || track.sender !== sender) return false;
  const confirmed = sender.getParameters().encodings?.find((encoding) => encoding.rid === 'f');
  return (
    confirmed !== undefined &&
    (confirmed.active === false || (firefox && previousBitrate !== 10 && confirmed.maxBitrate === 10))
  );
}

/** Our shared screen, at most RELIEVED_SCREEN_FRAME_RATE while the call is relieved. */
export async function applyVideoReliefToScreen(stream: MediaStream | null | undefined): Promise<boolean | null> {
  if (!state.videoRelieved || !stream) return null;
  return limitScreenCaptureFrameRate(stream, getScreenProfile(state.localScreenProfileId), RELIEVED_SCREEN_FRAME_RATE);
}

export async function reportVideoRelief(
  kind: 'video' | 'screen',
  attempt: Promise<boolean | null>,
  onResult?: (result: ProcessingRelief) => void
): Promise<void> {
  const applied = await attempt.catch(() => false);
  if (applied !== null) onResult?.({ kind, outcome: applied ? 'applied' : 'failed' });
}

/** Makes the call's video lighter, once per call; the start of a call clears it (room.ts). */
export async function relieveVideo(onResult?: (result: ProcessingRelief) => void): Promise<void> {
  if (!state.joined || state.videoRelieved) return;
  state.videoRelieved = true;
  const { localCameraPublication, localScreenStream } = state;
  await Promise.all([
    reportVideoRelief(
      'video',
      syncRemoteCameraDemand().then((changed) => (changed ? true : null)),
      onResult
    ),
    reportVideoRelief('video', applyVideoReliefToCamera(localCameraPublication), onResult),
    reportVideoRelief('screen', applyVideoReliefToScreen(localScreenStream), onResult)
  ]);
}
