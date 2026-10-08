// Our own tracks on the LiveKit room: the microphone, the camera and the shared screen.

import type { LocalTrackPublication, Room, Track } from 'livekit-client';
import {
  CAMERA_CAPTURE,
  CAMERA_VIDEO_BITRATE,
  MICROPHONE_AUDIO_BITRATE,
  SCREEN_AUDIO_BITRATE
} from '../../core/config';
import { state } from '../../core/state.svelte';
import { getScreenProfile, getScreenPublishVideoOptions } from '../../media/profiles';
import { loadLiveKitClient, TRACK_SOURCE } from '../../media/livekit-runtime';
import { isMicrophoneShownMuted } from '../../core/microphone-mute';

import { isCameraPublication, isMicrophonePublication } from './publication-kinds';

export async function publishLocalMicrophone(): Promise<void> {
  const room = state.livekitRoom;
  const stream = state.localStream;
  if (!room || !stream) return;
  await publishLocalMicrophoneForRoom(room, stream, () => state.livekitRoom === room && state.localStream === stream);
}

export async function publishLocalMicrophoneForRoom(
  room: Room,
  stream: MediaStream | null,
  isCurrent: () => boolean,
  commit = true
): Promise<LocalTrackPublication | null> {
  if (!stream || !isCurrent()) return null;
  const [track] = stream.getAudioTracks();
  if (!track) throw new Error('Браузер не отдал аудио-трек');

  const publication = await room.localParticipant.publishTrack(track, {
    audioPreset: { maxBitrate: MICROPHONE_AUDIO_BITRATE },
    dtx: true,
    name: 'microphone',
    red: true,
    source: TRACK_SOURCE.Microphone as Track.Source
  });
  if (!isCurrent()) {
    await room.localParticipant.unpublishTrack(publication.track ?? track, false).catch(() => {});
    return null;
  }
  if (commit) state.localMicPublication = publication;
  await syncMicrophonePublicationMuted(publication);
  if (!isCurrent()) {
    await room.localParticipant.unpublishTrack(publication.track ?? track, false).catch(() => {});
    return null;
  }
  return publication;
}

export async function unpublishLocalMicrophone(stopOnUnpublish = false): Promise<void> {
  if (!state.livekitRoom || !state.localMicPublication?.track) {
    state.localMicPublication = null;
    return;
  }

  await state.livekitRoom.localParticipant.unpublishTrack(state.localMicPublication.track, stopOnUnpublish);
  state.localMicPublication = null;
}

export async function syncLocalMicrophonePublicationMuted(): Promise<void> {
  const publication = state.localMicPublication;
  if (!publication) return;

  await syncMicrophonePublicationMuted(publication);
}

async function syncMicrophonePublicationMuted(publication: LocalTrackPublication): Promise<void> {
  // Push-to-talk idle stays unmuted on the SFU: the capture track is disabled, so
  // only silence (DTX) goes out, and peers do not get a mute event to show.
  if (isMicrophoneShownMuted()) {
    await publication.mute();
  } else {
    await publication.unmute();
  }
}

export async function publishLocalCamera(): Promise<void> {
  const room = state.livekitRoom;
  const stream = state.localCameraStream;
  if (!room || !stream) return;
  const publication = await publishLocalCameraForRoom(
    room,
    stream,
    () => state.livekitRoom === room && state.localCameraStream === stream
  );
  if (publication && state.livekitRoom === room && state.localCameraStream === stream) {
    state.localCameraPublication = publication;
  }
}

export async function publishLocalCameraForRoom(
  room: Room,
  stream: MediaStream | null,
  isCurrent: () => boolean
): Promise<LocalTrackPublication | null> {
  const [track] = stream?.getVideoTracks() ?? [];
  if (!track || track.readyState === 'ended' || !isCurrent()) return null;
  const { VideoPresets } = await loadLiveKitClient();
  if (!isCurrent()) return null;

  // Simulcast: a grid tile asks for a small layer, the spotlight for the top one.
  const publication = await room.localParticipant.publishTrack(track, {
    name: 'camera',
    simulcast: true,
    source: TRACK_SOURCE.Camera as Track.Source,
    videoEncoding: { maxBitrate: CAMERA_VIDEO_BITRATE, maxFramerate: CAMERA_CAPTURE.frameRate },
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360]
  });
  if (!isCurrent()) {
    await room.localParticipant.unpublishTrack(publication.track ?? track, false).catch(() => {});
    return null;
  }
  return publication;
}

export async function unpublishLocalCamera(): Promise<void> {
  const room = state.livekitRoom;
  const track = state.localCameraPublication?.track;
  state.localCameraPublication = null;
  if (!room || !track) return;
  // The capture is stopped by its owner, not by LiveKit.
  await room.localParticipant.unpublishTrack(track, false);
}

export async function ensureLocalCameraPublished(room: Room, isCurrent: () => boolean): Promise<void> {
  const stream = state.localCameraStream;
  if (!stream || !isCurrent()) return;
  const existing = [...room.localParticipant.trackPublications.values()].find(isCameraPublication);
  if (existing) {
    state.localCameraPublication = existing;
    return;
  }
  const publication = await publishLocalCameraForRoom(
    room,
    stream,
    () => isCurrent() && state.livekitRoom === room && state.localCameraStream === stream
  );
  if (publication && isCurrent() && state.livekitRoom === room && state.localCameraStream === stream) {
    state.localCameraPublication = publication;
  }
}

export async function publishLocalScreenTracks(): Promise<void> {
  const room = state.livekitRoom;
  const stream = state.localScreenStream;
  if (!room || !stream) return;
  const publications = await publishLocalScreenTracksForRoom(
    room,
    stream,
    () => state.livekitRoom === room && state.localScreenStream === stream
  );
  if (state.livekitRoom === room && state.localScreenStream === stream) state.localScreenPublications = publications;
}

export async function publishLocalScreenTracksForRoom(
  room: Room,
  stream: MediaStream | null,
  isCurrent: () => boolean,
  existing: Map<string, LocalTrackPublication> = new Map()
): Promise<Map<string, LocalTrackPublication>> {
  const publications = new Map<string, LocalTrackPublication>(existing);
  const created = new Map<string, LocalTrackPublication>();
  if (!stream || !isCurrent()) return publications;
  const profile = getScreenProfile(state.localScreenProfileId);
  for (const track of stream.getTracks().filter((candidate) => candidate.readyState !== 'ended')) {
    if (publications.has(track.id)) continue;
    const videoOptions = track.kind === 'video' ? await getScreenPublishVideoOptions(profile) : null;
    if (!isCurrent()) break;
    const publication = await room.localParticipant.publishTrack(track, {
      audioPreset: track.kind === 'audio' ? { maxBitrate: SCREEN_AUDIO_BITRATE } : undefined,
      // Shared audio is music and game sound: keep it stereo and continuous,
      // and skip RED, which would double a 192 kbps stream for little gain.
      ...(track.kind === 'audio' ? { dtx: false, forceStereo: true, red: false } : {}),
      name: track.kind === 'video' ? 'screen' : 'screen-audio',
      ...(videoOptions ?? {}),
      source: track.kind === 'video' ? videoOptions!.source : (TRACK_SOURCE.ScreenShareAudio as Track.Source),
      stream: stream.id
    });
    if (!isCurrent()) {
      await room.localParticipant.unpublishTrack(publication.track ?? track, false).catch(() => {});
      break;
    }
    publications.set(track.id, publication);
    created.set(track.id, publication);
  }
  if (!isCurrent()) await disposeCandidatePublications(room, created);
  return publications;
}

export async function disposeCandidatePublications(
  room: Room,
  publications: Map<string, LocalTrackPublication>
): Promise<void> {
  await Promise.allSettled(
    [...publications.values()].map((publication) => {
      const track = publication.track;
      return track ? room.localParticipant.unpublishTrack(track, false) : Promise.resolve();
    })
  );
  publications.clear();
}

export async function unpublishLocalScreenTracks(stopOnUnpublish = false): Promise<void> {
  const room = state.livekitRoom;
  if (!room || state.localScreenPublications.size === 0) {
    state.localScreenPublications.clear();
    return;
  }

  const publications = [...state.localScreenPublications.values()];
  state.localScreenPublications.clear();
  await Promise.allSettled(
    publications
      .map((publication) => publication.track)
      .filter((track): track is NonNullable<typeof track> => Boolean(track))
      .map((track) => room.localParticipant.unpublishTrack(track, stopOnUnpublish))
  );
}

export async function ensureLocalMicrophonePublished(): Promise<void> {
  const existingPublication = findLocalMicrophonePublication();
  if (existingPublication) {
    state.localMicPublication = existingPublication;
    await syncLocalMicrophonePublicationMuted();
    return;
  }

  if (state.livekitRoom && state.localStream) {
    await publishLocalMicrophone();
  }
}

export async function ensureLocalScreenPublished(room: Room, isCurrent: () => boolean): Promise<void> {
  const stream = state.localScreenStream;
  if (!stream || !isCurrent()) return;
  const publications = await publishLocalScreenTracksForRoom(
    room,
    stream,
    () => isCurrent() && state.livekitRoom === room && state.localScreenStream === stream,
    state.localScreenPublications
  );
  if (isCurrent() && state.livekitRoom === room && state.localScreenStream === stream) {
    state.localScreenPublications = publications;
  }
}

export function findLocalMicrophonePublication(): LocalTrackPublication | null {
  const publications = state.livekitRoom?.localParticipant?.trackPublications;
  if (!publications?.values) return null;
  return [...publications.values()].find(isMicrophonePublication) || null;
}

export function findFirstLocalPublication(): LocalTrackPublication | null {
  return state.livekitRoom?.localParticipant?.trackPublications?.values?.().next?.().value || null;
}
