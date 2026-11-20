import { TrackSource } from 'livekit-server-sdk';
import { ROOM_SURFACE_CEILINGS, type RoomSurface } from '../rooms/room-surface.policy.ts';

export function liveKitPublishSources(
  surface: RoomSurface,
  { microphone = true, screen = true }: { microphone?: boolean; screen?: boolean } = {}
): TrackSource[] {
  const ceiling = ROOM_SURFACE_CEILINGS[surface];
  const sources: TrackSource[] = [];
  if (microphone) sources.push(TrackSource.MICROPHONE);
  if (ceiling.camera) sources.push(TrackSource.CAMERA);
  if (ceiling.screenShare && screen) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  return sources;
}
