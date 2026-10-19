import type * as LiveKitClientModule from './livekit-client';

export const TRACK_SOURCE = {
  Camera: 'camera',
  Microphone: 'microphone',
  ScreenShare: 'screen_share',
  ScreenShareAudio: 'screen_share_audio'
} as const;

let livekitClientPromise: Promise<typeof LiveKitClientModule> | null = null;

export function loadLiveKitClient(): Promise<typeof LiveKitClientModule> {
  livekitClientPromise ||= import('./livekit-client');
  return livekitClientPromise;
}
