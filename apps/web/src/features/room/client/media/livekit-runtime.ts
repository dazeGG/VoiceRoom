import type { Track } from 'livekit-client';
import type * as LiveKitClientModule from './livekit-client';

export const TRACK_SOURCE = {
  Camera: 'camera',
  Microphone: 'microphone',
  ScreenShare: 'screen_share',
  ScreenShareAudio: 'screen_share_audio'
} as const satisfies Record<string, `${Track.Source}`>;

let livekitClientPromise: Promise<typeof LiveKitClientModule> | null = null;

// The library is fetched ahead of a call (features/room/prefetch.ts); a load
// that failed then is asked again by the next caller, not handed out as cached.
export function loadLiveKitClient(): Promise<typeof LiveKitClientModule> {
  livekitClientPromise ||= import('./livekit-client').catch((error: unknown) => {
    livekitClientPromise = null;
    throw error;
  });
  return livekitClientPromise;
}
