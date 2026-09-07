export const MUSIC_CONTRACT_VERSION: 1;
export const MUSIC_QUEUE_MAX_ITEMS: 100;
export const MUSIC_EXPANSION_MAX_ITEMS: 50;
export const MUSIC_HEARTBEAT_INTERVAL_MS: 2000;
export const MUSIC_POSITION_STALE_MS: 6000;
export const MUSIC_WATCHDOG_GRACE_MS: 15000;
export const MUSIC_LINK_MAX_LENGTH: 2048;
export const MUSIC_ID_MAX_LENGTH: 128;
export const MUSIC_TITLE_MAX_LENGTH: 256;
export const MUSIC_ARTIST_MAX_LENGTH: 256;
export const MUSIC_COVER_URL_MAX_LENGTH: 1024;

export type MusicSessionStatus = 'idle' | 'resolving' | 'playing' | 'unavailable';
export type MusicTrackRefKind = 'video' | 'playlist';
export type MusicSource = 'vk' | 'rutube' | 'youtube';
export type MusicErrorCode =
  | 'forbidden'
  | 'room_not_static'
  | 'queue_capacity_exceeded'
  | 'invalid_link'
  | 'source_unavailable'
  | 'music_unavailable';
export type MusicClientCommandType =
  | 'room.music.enqueue'
  | 'room.music.skip'
  | 'room.music.remove'
  | 'room.music.stop';

export const MUSIC_SESSION_STATUSES: readonly MusicSessionStatus[];
export const MUSIC_TRACK_REF_KINDS: readonly MusicTrackRefKind[];
export const MUSIC_SOURCES: readonly MusicSource[];
export const MUSIC_ERROR_CODES: readonly MusicErrorCode[];
export const MUSIC_CLIENT_COMMAND_TYPES: readonly MusicClientCommandType[];
export const MUSIC_SOURCE_HOSTS: Readonly<Record<MusicSource, readonly string[]>>;
export const MUSIC_CANONICAL_HOSTS: Readonly<Record<MusicSource, string>>;

export interface MusicTrackRef {
  source: MusicSource;
  kind: MusicTrackRefKind;
  id: string;
  /** Set when `kind` is 'video', null otherwise. */
  videoId: string | null;
  /** Set when `kind` is 'playlist', null otherwise. */
  playlistId: string | null;
  sourceUrl: string;
}

export interface MusicQueueItem {
  id: string;
  trackRef: MusicTrackRef;
  addedBy: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  durationMs: number | null;
}

export interface MusicSession {
  contractVersion: 1;
  status: MusicSessionStatus;
  currentItem: MusicQueueItem | null;
  positionMs: number;
  positionAt: number | null;
  queue: MusicQueueItem[];
  sessionEpoch: number;
}

export type MusicEnqueuePlan<T> =
  | { ok: true; items: T[] }
  | { ok: false; code: Extract<MusicErrorCode, 'queue_capacity_exceeded' | 'invalid_link'> };

export type MusicCommand =
  | { type: 'room.music.enqueue'; trackRef: MusicTrackRef }
  | { type: 'room.music.skip'; itemId: string | null }
  | { type: 'room.music.remove'; itemId: string }
  | { type: 'room.music.stop' };

export function isMusicSessionStatus(value: unknown): value is MusicSessionStatus;
export function isMusicErrorCode(value: unknown): value is MusicErrorCode;
export function isMusicSource(value: unknown): value is MusicSource;
export function normalizeMusicLink(value: unknown): MusicTrackRef | null;
export function normalizeMusicTrackRef(value: unknown): MusicTrackRef | null;
export function isMusicExpandableRef(value: unknown): boolean;
export function normalizeMusicItemId(value: unknown): string | null;
export function normalizeMusicQueueItem(value: unknown): MusicQueueItem | null;
export function planMusicEnqueue<T>(input?: { queueLength?: number; items?: T[] }): MusicEnqueuePlan<T> | null;
export function isMusicPositionStale(positionAt: unknown, now?: number): boolean;
export function normalizeMusicSession(value: unknown): MusicSession | null;
export function buildMusicSession(input?: {
  status?: unknown;
  currentItem?: unknown;
  positionMs?: unknown;
  positionAt?: unknown;
  queue?: unknown[];
  sessionEpoch?: unknown;
}): MusicSession;
export function normalizeMusicCommand(type: unknown, payload?: unknown): MusicCommand | null;
