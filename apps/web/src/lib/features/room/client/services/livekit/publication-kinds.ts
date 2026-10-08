// Which kind of track a LiveKit publication carries.

import type { TrackPublication } from 'livekit-client';
import { TRACK_SOURCE } from '../../media/livekit-runtime';

// LiveKit types the source as its own enum; its values are these strings.
function sourceOf(publication: TrackPublication | null | undefined): string | undefined {
  return publication?.source;
}

export function isCameraPublication(publication: TrackPublication | null | undefined): boolean {
  return sourceOf(publication) === TRACK_SOURCE.Camera;
}

export function isMicrophonePublication(publication: TrackPublication | null | undefined): boolean {
  return sourceOf(publication) === TRACK_SOURCE.Microphone;
}

export function isScreenPublication(publication: TrackPublication | null | undefined): boolean {
  return isScreenVideoPublication(publication) || isScreenAudioPublication(publication);
}

export function isScreenVideoPublication(publication: TrackPublication | null | undefined): boolean {
  return sourceOf(publication) === TRACK_SOURCE.ScreenShare;
}

export function isScreenAudioPublication(publication: TrackPublication | null | undefined): boolean {
  return sourceOf(publication) === TRACK_SOURCE.ScreenShareAudio;
}
