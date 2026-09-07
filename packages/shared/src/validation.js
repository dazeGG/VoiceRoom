'use strict';

const SCREEN_PROFILE_IDS = new Set([
  'balanced',
  'balanced-5',
  'balanced-15',
  'balanced-30',
  'high',
  'high-5',
  'high-15',
  'high-30',
  'low',
  'low-15',
  'low-30',
  'source',
  'source-5',
  'source-15',
  'source-30'
]);

const PRESENCE_STATUSES = Object.freeze([
  'online',
  'away',
  'dnd',
  'offline'
]);
const PRESENCE_STATUS_SET = new Set(PRESENCE_STATUSES);

function normalizeRoomId(value) {
  if (typeof value !== 'string') return '';
  const roomId = value.trim();
  return /^[A-Za-z0-9_-]{3,48}$/.test(roomId) ? roomId : '';
}

// Identity namespaces the server mints for participants it owns rather than for
// a human peer — currently only the music bot. A client must never be able to
// present one as its own peer id: such a peer is audible in the room but absent
// from the participant list, so per-peer mute and kick cannot reach it. The
// prefixes live here, in the one module every join and WS command already goes
// through, so a change to the minted identity format cannot silently reopen the
// hole. Lower-cased; matching is prefix-based and case-insensitive so neither a
// separator change (`music-bot-x` -> `music-bot:x`) nor `MUSIC-BOT-x` escapes it.
const RESERVED_PEER_ID_PREFIXES = Object.freeze(['music-bot']);

function isReservedPeerId(value) {
  if (typeof value !== 'string') return false;
  const candidate = value.trim().toLowerCase();
  return RESERVED_PEER_ID_PREFIXES.some((prefix) => candidate.startsWith(prefix));
}

function normalizePeerId(value) {
  if (typeof value !== 'string') return '';
  const peerId = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(peerId)) return '';
  return isReservedPeerId(peerId) ? '' : peerId;
}

function normalizeSessionToken(value) {
  if (typeof value !== 'string') return '';
  const token = value.trim();
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : '';
}

function cleanName(value) {
  if (typeof value !== 'string') return 'Guest';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Guest';
  return compact.slice(0, 40);
}

// Account login: lower-cased handle, 3–32 chars of [a-z0-9._-]. Returns '' when
// the value can't be a valid login so callers can branch on the empty string.
function normalizeLogin(value) {
  if (typeof value !== 'string') return '';
  const login = value.trim().toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(login) ? login : '';
}

// Optional display name shown to other people. Unlike cleanName it never
// substitutes a "Guest" fallback — an empty result means "not provided".
function cleanDisplayName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 40);
}

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 200;

function isValidPassword(value) {
  return typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

// Optional room name shown in the lobby and in-room. Empty result means "no name"
// (room is then identified by its code).
function cleanRoomName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Curated visual identity keys live in JSON so both the CommonJS backend and
// the Vite/Svelte frontend can consume the same vocabulary without SSR loading
// this CommonJS validation module. The frontend owns CSS/OKLCH rendering values.
const visualIdentity = require('./visual-identity.json');

const AVATAR_COLOR_KEYS = visualIdentity.AVATAR_COLOR_KEYS;
const AVATAR_COLOR_KEY_SET = new Set(AVATAR_COLOR_KEYS);

function cleanAvatarColorKey(value) {
  return typeof value === 'string' && AVATAR_COLOR_KEY_SET.has(value) ? value : '';
}

function cleanPresenceStatus(value) {
  return typeof value === 'string' && PRESENCE_STATUS_SET.has(value) ? value : '';
}

function cleanStreamId(value) {
  if (typeof value !== 'string') return '';
  const streamId = value.trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(streamId) ? streamId : '';
}

function cleanScreenProfileId(value) {
  if (typeof value !== 'string') return '';
  const profileId = value.trim();
  return SCREEN_PROFILE_IDS.has(profileId) ? profileId : '';
}

function cleanLiveKitUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return /^wss?:\/\/[^\s/$.?#].[^\s]*$/i.test(url) ? url : '';
}

module.exports = {
  AVATAR_COLOR_KEYS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PRESENCE_STATUSES,
  RESERVED_PEER_ID_PREFIXES,
  SCREEN_PROFILE_IDS,
  cleanAvatarColorKey,
  cleanDisplayName,
  cleanLiveKitUrl,
  cleanName,
  cleanPresenceStatus,
  cleanRoomName,
  cleanScreenProfileId,
  cleanStreamId,
  isReservedPeerId,
  isValidPassword,
  normalizeLogin,
  normalizePeerId,
  normalizeRoomId,
  normalizeSessionToken
};
