// The server-wide media budget. Video is what loads the media server: each
// screen share and camera sends its bitrate to every other person in its room.
// Summed over all rooms that must stay under MEDIA_BUDGET_MBPS, so a client
// asks (room.media.request) before it starts one, and a busy server offers a
// lower screen profile or refuses. A screen share started without asking, by
// an older client, still counts, as it shows in presence; an older client's
// camera does not, since only newer clients report cameras.
//
// The check runs when a stream starts. A room that grows afterwards makes its
// streams dearer without asking anyone, so a new stream is charged for at least
// MEDIA_MIN_VIEWERS viewers even in a smaller room; past that the SFU's own
// limits (LIVEKIT_LIMIT_BYTES_PER_SEC) and its habit of dropping video before
// voice are the backstop.
//
// Voice and video share the media server's CPU, and the SFU keeps voice when
// it runs short, so a busy voice server breaks streams long before either load
// breaks it alone (load test 2026-10-17: with 376 people in voice a 720p share
// watched by 24 lost a third of its packets). With MEDIA_BUDGET_VOICE_PEERS set
// the budget shrinks linearly with the people in voice and is gone at that many.

import { CAMERA_VIEWER_BITRATE, screenProfileBitrate, screenProfileFallbacks } from '@voice-room/shared/media-budget';
import type { MediaGrant, MediaKind } from '@voice-room/shared/contracts/realtime';
import type { Peer, PresenceRoom } from './runtime-types.ts';

/** How long a grant holds its share of the budget until the stream shows up in presence. */
export const MEDIA_CLAIM_TTL_MS = 60_000;

/** The room size a new stream is charged for at the least: a room of 9. */
export const MEDIA_MIN_VIEWERS = 8;

/** 0 turns a limit off. */
export type MediaLimits = { budgetBps: number; maxRoomScreens: number; minViewers: number; voicePeersAtZero: number };

function screenBitrate(peer: Peer, now: number): number {
  if (peer.screen) return screenProfileBitrate(peer.screenProfileId || '');
  const claim = peer.mediaClaims?.screen;
  return claim && claim.expiresAt > now ? screenProfileBitrate(claim.profileId) : 0;
}

function cameraBitrate(peer: Peer, now: number): number {
  if (peer.camera) return CAMERA_VIEWER_BITRATE;
  const claim = peer.mediaClaims?.camera;
  return claim && claim.expiresAt > now ? CAMERA_VIEWER_BITRATE : 0;
}

function viewersIn(room: PresenceRoom): number {
  return Math.max(0, room.peers.size - 1);
}

/**
 * What every screen share and camera on the server sends its viewers, in bit/s.
 * `except` leaves out one peer's own source of one kind: a restart replaces it.
 */
export function serverMediaBps(
  rooms: Iterable<PresenceRoom, unknown, unknown>,
  now: number,
  except?: { peer: Peer; kind: MediaKind }
): number {
  let total = 0;
  for (const room of rooms) {
    const viewers = viewersIn(room);
    if (viewers === 0) continue;
    for (const peer of room.peers.values()) {
      const screen = except?.peer === peer && except.kind === 'screen' ? 0 : screenBitrate(peer, now);
      const camera = except?.peer === peer && except.kind === 'camera' ? 0 : cameraBitrate(peer, now);
      total += (screen + camera) * viewers;
    }
  }
  return total;
}

/** Whether `peer` may start a screen share or a camera now, and at which screen profile. */
export function decideMediaRequest(input: {
  rooms: Iterable<PresenceRoom, unknown, unknown>;
  room: PresenceRoom;
  peer: Peer;
  kind: MediaKind;
  profileId: string;
  limits: MediaLimits;
  now: number;
}): MediaGrant {
  const { room, peer, kind, profileId, limits, now } = input;
  const rooms = Array.from(input.rooms);
  const roomId = room.id;

  if (kind === 'screen' && limits.maxRoomScreens > 0) {
    let screens = 0;
    for (const other of room.peers.values()) if (other !== peer && screenBitrate(other, now) > 0) screens += 1;
    if (screens >= limits.maxRoomScreens) {
      return { roomId, kind, granted: false, reason: 'room_screens_full', maxRoomScreens: limits.maxRoomScreens };
    }
  }

  const candidates = kind === 'screen' ? screenProfileFallbacks(profileId) : [''];
  if (limits.budgetBps <= 0) return grant(roomId, kind, candidates[0] ?? '');

  const available = budgetBps(rooms, limits) - serverMediaBps(rooms, now, { peer, kind });
  const viewers = Math.max(viewersIn(room), limits.minViewers);
  for (const candidate of candidates) {
    const bitrate = kind === 'screen' ? screenProfileBitrate(candidate) : CAMERA_VIEWER_BITRATE;
    if (bitrate * viewers <= available) return grant(roomId, kind, candidate);
  }
  return { roomId, kind, granted: false, reason: 'server_busy' };
}

/** The video budget left once voice has taken its share of the media server. */
function budgetBps(rooms: PresenceRoom[], limits: MediaLimits): number {
  if (limits.voicePeersAtZero <= 0) return limits.budgetBps;
  let voicePeers = 0;
  for (const room of rooms) voicePeers += room.peers.size;
  return limits.budgetBps * Math.max(0, 1 - voicePeers / limits.voicePeersAtZero);
}

function grant(roomId: string, kind: MediaKind, profileId: string): MediaGrant {
  return kind === 'screen' ? { roomId, kind, granted: true, profileId } : { roomId, kind, granted: true };
}

/** Holds the granted share of the budget until the stream itself is in presence. */
export function claimMedia(peer: Peer, granted: MediaGrant, now: number): void {
  if (!granted.granted) return;
  const expiresAt = now + MEDIA_CLAIM_TTL_MS;
  const claims = peer.mediaClaims ?? {};
  if (granted.kind === 'screen') claims.screen = { profileId: granted.profileId || '', expiresAt };
  else claims.camera = { expiresAt };
  peer.mediaClaims = claims;
}
