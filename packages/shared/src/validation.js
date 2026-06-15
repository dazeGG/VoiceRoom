'use strict';

const SCREEN_PROFILE_IDS = new Set([
  'balanced',
  'balanced-15',
  'balanced-30',
  'high',
  'high-15',
  'high-30',
  'low',
  'low-15',
  'low-30'
]);

function normalizeRoomId(value) {
  if (typeof value !== 'string') return '';
  const roomId = value.trim();
  return /^[A-Za-z0-9_-]{3,48}$/.test(roomId) ? roomId : '';
}

function normalizePeerId(value) {
  if (typeof value !== 'string') return '';
  const peerId = value.trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(peerId) ? peerId : '';
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

// Fixed palette of room icons. Restricting to a known set keeps emoji validation
// trivial and storage bounded — the picker on the client offers exactly these.
const ROOM_EMOJIS = ['🎧', '📌', '🌙', '☀️', '🎮', '🎙️', '🔥'];

function cleanRoomEmoji(value) {
  return typeof value === 'string' && ROOM_EMOJIS.includes(value) ? value : '';
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
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ROOM_EMOJIS,
  SCREEN_PROFILE_IDS,
  cleanDisplayName,
  cleanLiveKitUrl,
  cleanName,
  cleanRoomEmoji,
  cleanRoomName,
  cleanScreenProfileId,
  cleanStreamId,
  isValidPassword,
  normalizeLogin,
  normalizePeerId,
  normalizeRoomId,
  normalizeSessionToken
};
