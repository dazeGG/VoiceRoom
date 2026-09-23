// Validators both sides agree on: ids, tokens, names, logins, passwords,
// avatar colours, presence and screen-share profiles. Each returns the clean
// value or an empty string, never throws.

import visualIdentity from './visual-identity.mts';

export type AvatarColorKey =
  | 'blurple'
  | 'violet'
  | 'orchid'
  | 'magenta'
  | 'rose'
  | 'coral'
  | 'rust'
  | 'amber'
  | 'olive'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'slate';

export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

export const SCREEN_PROFILE_IDS: ReadonlySet<string> = new Set([
  'balanced',
  'balanced-5',
  'balanced-15',
  'balanced-30',
  'balanced-60',
  'high',
  'high-5',
  'high-15',
  'high-30',
  'high-60',
  'low',
  'low-15',
  'low-30',
  'source',
  'source-5',
  'source-15',
  'source-30',
  'source-60'
]);

export const PRESENCE_STATUSES: readonly PresenceStatus[] = Object.freeze([
  'online',
  'away',
  'dnd',
  'offline'
]);
const PRESENCE_STATUS_SET = new Set<unknown>(PRESENCE_STATUSES);

export function normalizeRoomId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const roomId = value.trim();
  return /^[A-Za-z0-9_-]{3,48}$/.test(roomId) ? roomId : '';
}

export function normalizePeerId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const peerId = value.trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(peerId) ? peerId : '';
}

// `auth-<userId>` is the peer id the API assigns to a signed-in user's lobby
// messages and typing. It carries account authorship, so no connection may
// claim it as its own room peer id: a guest holding `auth-<victim>` would
// otherwise pass the peer-author checks on the victim's messages.
export const ACCOUNT_PEER_ID_PREFIX = 'auth-' as const;

export function accountPeerIdFor(userId: unknown): string {
  return typeof userId === 'string' && userId ? normalizePeerId(`${ACCOUNT_PEER_ID_PREFIX}${userId}`) : '';
}

export function isReservedPeerId(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith(ACCOUNT_PEER_ID_PREFIX);
}

export function normalizeSessionToken(value: unknown): string {
  if (typeof value !== 'string') return '';
  const token = value.trim();
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : '';
}

export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return 'Guest';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Guest';
  return compact.slice(0, 40);
}

// Account login: lower-cased handle, 3–32 chars of [a-z0-9._-]. Returns '' when
// the value can't be a valid login so callers can branch on the empty string.
export function normalizeLogin(value: unknown): string {
  if (typeof value !== 'string') return '';
  const login = value.trim().toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(login) ? login : '';
}

// Optional display name shown to other people. Unlike cleanName it never
// substitutes a "Guest" fallback: an empty result means "not provided".
export function cleanDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 40);
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export function isValidPassword(value: unknown): boolean {
  return typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

// Optional room name shown in the lobby and in-room. Empty result means "no
// name" (the room is then identified by its code).
export function cleanRoomName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 60);
}

// The avatar colour vocabulary lives in JSON so the API and the web read the
// same list; the web owns the rendering values.
export const AVATAR_COLOR_KEYS: readonly AvatarColorKey[] = visualIdentity.AVATAR_COLOR_KEYS;
const AVATAR_COLOR_KEY_SET = new Set<unknown>(AVATAR_COLOR_KEYS);

export function cleanAvatarColorKey(value: unknown): AvatarColorKey | '' {
  return typeof value === 'string' && AVATAR_COLOR_KEY_SET.has(value) ? value as AvatarColorKey : '';
}

export function cleanPresenceStatus(value: unknown): PresenceStatus | '' {
  return typeof value === 'string' && PRESENCE_STATUS_SET.has(value) ? value as PresenceStatus : '';
}

export function cleanStreamId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const streamId = value.trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(streamId) ? streamId : '';
}

export function cleanScreenProfileId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const profileId = value.trim();
  return SCREEN_PROFILE_IDS.has(profileId) ? profileId : '';
}

export function cleanLiveKitUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return /^wss?:\/\/[^\s/$.?#].[^\s]*$/i.test(url) ? url : '';
}
