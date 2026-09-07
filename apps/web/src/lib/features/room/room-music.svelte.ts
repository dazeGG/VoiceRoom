// Shared-music state for the open room.
//
// The server owns the queue and the playback session; this store only ever
// replaces its snapshot, exactly like `pins.svelte.ts`. The one thing it owns
// outright is the pair of local listening preferences (`muted`, `volume`): they
// are persisted on this client, applied as gain on the `'media'` audio bus, and
// are NEVER sent over the WebSocket — one listener's silence must not stop the
// music for the room.

import {
  buildMusicSession,
  isMusicErrorCode,
  isMusicPositionStale,
  type MusicErrorCode,
  type MusicQueueItem,
  type MusicSession
} from '@voice-room/shared/room-music';
import {
  enqueueRoomMusic,
  removeRoomMusicItem,
  skipRoomMusic,
  stopRoomMusic
} from '$lib/api/realtime';
import { state } from './client/core/state.svelte';
import {
  musicPreferences,
  setMusicPreferenceMuted,
  setMusicPreferenceVolume
} from './client/core/music-preferences.svelte';
import { syncMusicAudioPlayback } from './client/services/media-playback-service';
import { setMusicBotIdentity } from './client/services/livekit-service';

export const roomMusic = $state({
  roomId: '',
  /** The player is not rendered at all in a temporary room. */
  isStatic: false,
  /**
   * The viewer is the room master. Resolved by the server and delivered on the
   * snapshot: nothing else on the wire carries the room's owner, so the client
   * cannot derive this. Guests are never master.
   */
  isMaster: false,
  /** True once an active-mode snapshot carried a music block. */
  loaded: false,
  panelOpen: false,
  linkInput: '',
  error: '',
  session: buildMusicSession()
});

// The listener's mute and volume are deliberately NOT fields of `roomMusic`.
// They live in one place that both the UI and the audio routing read, so the
// slider cannot show a value the gain node is not applying.
export { musicPreferences } from './client/core/music-preferences.svelte';

export function resetRoomMusic(): void {
  roomMusic.roomId = '';
  roomMusic.isStatic = false;
  roomMusic.isMaster = false;
  roomMusic.loaded = false;
  roomMusic.panelOpen = false;
  roomMusic.linkInput = '';
  roomMusic.error = '';
  roomMusic.session = buildMusicSession();
  setMusicBotIdentity('');
}

export function isRoomMusicVisible(): boolean {
  return roomMusic.isStatic && roomMusic.roomId === state.roomId && Boolean(state.roomId);
}

export function toggleRoomMusicPanel(): void {
  roomMusic.panelOpen = !roomMusic.panelOpen;
}

export function closeRoomMusicPanel(): void {
  roomMusic.panelOpen = false;
}

type MusicStatePayload = {
  roomId?: unknown;
  music?: unknown;
  musicBotIdentity?: unknown;
};

type MusicPositionPayload = {
  roomId?: unknown;
  musicBotIdentity?: unknown;
  sessionEpoch?: unknown;
  itemId?: unknown;
  positionMs?: unknown;
  positionAt?: unknown;
};

function readSession(music: unknown): MusicSession {
  return music && typeof music === 'object'
    ? buildMusicSession(music as Record<string, unknown>)
    : buildMusicSession();
}

/** `null` from the server means "no bot in the room"; it reads as no identity. */
function readBotIdentity(identity: unknown): string {
  return typeof identity === 'string' ? identity : '';
}

function isCurrentRoom(roomId: unknown): boolean {
  const id = String(roomId || '');
  return Boolean(id) && id === state.roomId && id === roomMusic.roomId;
}

/**
 * Applies the music block of a `room.snapshot`.
 *
 * The bot identity is pushed into the media lane on every snapshot — not only
 * when it changes — because `reconcileMusicPublication` is what picks up a
 * publication that already existed before this client connected, and the
 * snapshot is the one event guaranteed to arrive after a (re)join.
 */
export function applyRoomMusicSnapshot(snapshot: {
  roomId?: unknown;
  mode?: unknown;
  room?: { isStatic?: unknown } | null;
  music?: unknown;
  musicBotIdentity?: unknown;
  musicIsMaster?: unknown;
}): void {
  const roomId = String(snapshot.roomId || '');
  if (!roomId || roomId !== state.roomId) return;

  roomMusic.roomId = roomId;
  roomMusic.isStatic = Boolean(snapshot.room?.isStatic);

  if (snapshot.mode !== 'active' || !roomMusic.isStatic) {
    // A preview snapshot never carries the queue, and a temporary room has no
    // player at all: drop any stale session rather than showing it.
    roomMusic.loaded = false;
    roomMusic.isMaster = false;
    roomMusic.session = buildMusicSession();
    setMusicBotIdentity('');
    return;
  }

  roomMusic.session = readSession(snapshot.music);
  roomMusic.isMaster = Boolean(snapshot.musicIsMaster);
  roomMusic.loaded = true;
  setMusicBotIdentity(readBotIdentity(snapshot.musicBotIdentity));
}

/** Applies a `room.music.state` realtime event. Ignores other rooms. */
export function applyRoomMusicState(payload: MusicStatePayload): void {
  if (!isCurrentRoom(payload.roomId) || !roomMusic.isStatic) return;

  roomMusic.session = readSession(payload.music);
  roomMusic.loaded = true;
  setMusicBotIdentity(readBotIdentity(payload.musicBotIdentity));
}

/**
 * Applies a `room.music.position` realtime event — the 2s heartbeat, kept
 * separate so it does not re-broadcast the whole queue.
 *
 * `(sessionEpoch, itemId)` is the staleness guard: a heartbeat that was already
 * in flight when the track changed would otherwise rewind the progress of the
 * track that replaced it.
 */
export function applyRoomMusicPosition(payload: MusicPositionPayload): void {
  if (!isCurrentRoom(payload.roomId) || !roomMusic.isStatic) return;
  // The identity rides on this event too, because the bot can leave the room on
  // its own initiative and no state event is guaranteed to follow.
  setMusicBotIdentity(readBotIdentity(payload.musicBotIdentity));

  const session = roomMusic.session;
  if (Number(payload.sessionEpoch) !== session.sessionEpoch) return;
  if ((payload.itemId ?? null) !== (session.currentItem?.id ?? null)) return;

  const positionMs = Number(payload.positionMs);
  const positionAt = Number(payload.positionAt);
  roomMusic.session = {
    ...session,
    positionMs: Number.isFinite(positionMs) ? Math.max(0, positionMs) : session.positionMs,
    positionAt: Number.isFinite(positionAt) ? positionAt : session.positionAt
  };
}

// --- Local listening preferences (client-only) ----------------------------

export function setRoomMusicMuted(muted: boolean): void {
  setMusicPreferenceMuted(muted);
  syncMusicAudioPlayback();
}

export function toggleRoomMusicMuted(): void {
  setRoomMusicMuted(!musicPreferences.muted);
}

export function setRoomMusicVolume(volume: number): void {
  setMusicPreferenceVolume(volume);
  syncMusicAudioPlayback();
}

// --- Permissions ----------------------------------------------------------
// Authorship is by `peerId`, matching the server: a guest has no account id, so
// comparing accounts would make every guest the author of every guest's item.
// These only decide what is drawn — the server rejects the command regardless.

export function isRoomMusicMaster(): boolean {
  return roomMusic.isMaster;
}

export function canControlMusicItem(item: MusicQueueItem | null | undefined): boolean {
  if (!item) return false;
  return isRoomMusicMaster() || item.addedBy === state.peerId;
}

export function isMusicPositionAuthoritative(): boolean {
  return !isMusicPositionStale(roomMusic.session.positionAt);
}

// --- Errors ---------------------------------------------------------------

/**
 * Names the sources this build accepts. `MUSIC_SOURCES` in the shared contract
 * is the authority on that list; this is its human spelling, kept in one place
 * so the input hint and the `invalid_link` message can never disagree.
 */
export const MUSIC_LINK_HINT = 'Нужна ссылка на видео или плейлист VK Видео, Rutube или YouTube';

// The server answers a rejected music command with a shared error code and an
// English developer message. The code is the part meant for a person, so it is
// translated here and shown in the panel instead of the raw message.
//
// `source_unavailable` deliberately does not read as a bad link. The link
// parsed against the same contract this client uses; only the deployment cannot
// reach that source. Telling the user their link is wrong would send them off
// editing something that was already correct.

const MUSIC_ERROR_MESSAGES: Record<MusicErrorCode, string> = {
  forbidden: 'Управлять этим может только тот, кто его добавил, или хозяин комнаты',
  room_not_static: 'Музыка работает только в постоянных комнатах',
  queue_capacity_exceeded: 'Очередь переполнена — сначала освободите в ней место',
  invalid_link: MUSIC_LINK_HINT,
  source_unavailable: 'Ссылка верная, но этот сервис сейчас недоступен с нашего сервера',
  music_unavailable: 'Музыка сейчас недоступна'
};

/**
 * Routes a server error code into the panel. Returns false when the code is not
 * a music one, so the caller can fall back to its generic error handling.
 */
export function applyRoomMusicError(code: unknown): boolean {
  if (!isMusicErrorCode(code)) return false;
  roomMusic.error = MUSIC_ERROR_MESSAGES[code];
  return true;
}

// --- Commands -------------------------------------------------------------

export function submitRoomMusicLink(): boolean {
  const link = roomMusic.linkInput.trim();
  if (!link) return false;
  if (!enqueueRoomMusic(roomMusic.roomId, link)) {
    roomMusic.error = MUSIC_LINK_HINT;
    return false;
  }
  roomMusic.error = '';
  roomMusic.linkInput = '';
  return true;
}

export function skipRoomMusicItem(itemId: string | null = null): boolean {
  return skipRoomMusic(roomMusic.roomId, itemId);
}

export function removeRoomMusicQueueItem(itemId: string): boolean {
  return removeRoomMusicItem(roomMusic.roomId, itemId);
}

export function stopRoomMusicPlayback(): boolean {
  if (!isRoomMusicMaster()) return false;
  return stopRoomMusic(roomMusic.roomId);
}
