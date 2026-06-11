export const TRACK_SOURCE = {
  Microphone: 'microphone',
  ScreenShare: 'screen_share',
  ScreenShareAudio: 'screen_share_audio'
} as const;

let livekitClientPromise: Promise<typeof import('./livekit-client')> | null = null;

export function loadLiveKitClient(): Promise<typeof import('./livekit-client')> {
  livekitClientPromise ||= import('./livekit-client');
  return livekitClientPromise;
}
