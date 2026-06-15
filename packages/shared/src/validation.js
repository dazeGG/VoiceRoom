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

// Curated high-contrast avatar colors. The backend stores only these stable
// keys; the frontend owns the OKLCH/CSS rendering values.
const AVATAR_COLOR_KEYS = [
  'blurple',
  'violet',
  'orchid',
  'magenta',
  'rose',
  'coral',
  'rust',
  'amber',
  'olive',
  'green',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'slate'
];
const AVATAR_COLOR_KEY_SET = new Set(AVATAR_COLOR_KEYS);

function cleanAvatarColorKey(value) {
  return typeof value === 'string' && AVATAR_COLOR_KEY_SET.has(value) ? value : '';
}

// Room visuals are architecturally split into an icon key and a background
// color key. MVP creation may expose curated presets, but storage should keep
// icon/color keys independent so later UI can edit either side.
const ROOM_ICON_KEYS = [
  'headphones',
  'pin',
  'moon',
  'sun',
  'gamepad',
  'mic',
  'fire',
  'coffee',
  'music',
  'book'
];
const ROOM_COLOR_KEYS = [
  'blue',
  'slate',
  'violet',
  'amber',
  'indigo',
  'rose',
  'rust',
  'green'
];
const ROOM_ICON_KEY_SET = new Set(ROOM_ICON_KEYS);
const ROOM_COLOR_KEY_SET = new Set(ROOM_COLOR_KEYS);

const ROOM_PRESETS = [
  { key: 'voice-blue', iconKey: 'headphones', emoji: '🎧', colorKey: 'blue' },
  { key: 'focus-slate', iconKey: 'pin', emoji: '📌', colorKey: 'slate' },
  { key: 'night-violet', iconKey: 'moon', emoji: '🌙', colorKey: 'violet' },
  { key: 'day-amber', iconKey: 'sun', emoji: '☀️', colorKey: 'amber' },
  { key: 'game-indigo', iconKey: 'gamepad', emoji: '🎮', colorKey: 'indigo' },
  { key: 'talk-rose', iconKey: 'mic', emoji: '🎙️', colorKey: 'rose' },
  { key: 'fire-rust', iconKey: 'fire', emoji: '🔥', colorKey: 'rust' },
  { key: 'coffee-amber', iconKey: 'coffee', emoji: '☕', colorKey: 'amber' },
  { key: 'music-rose', iconKey: 'music', emoji: '🎵', colorKey: 'rose' },
  { key: 'study-green', iconKey: 'book', emoji: '📚', colorKey: 'green' }
];
const ROOM_PRESET_KEYS = ROOM_PRESETS.map((preset) => preset.key);
const ROOM_PRESET_KEY_SET = new Set(ROOM_PRESET_KEYS);

// Legacy emoji palette remains exported during migration. It mirrors the room
// presets that existed before icon/color keys were introduced.
const ROOM_EMOJIS = ROOM_PRESETS.slice(0, 7).map((preset) => preset.emoji);

function cleanRoomEmoji(value) {
  return typeof value === 'string' && ROOM_EMOJIS.includes(value) ? value : '';
}

function cleanRoomIconKey(value) {
  return typeof value === 'string' && ROOM_ICON_KEY_SET.has(value) ? value : '';
}

function cleanRoomColorKey(value) {
  return typeof value === 'string' && ROOM_COLOR_KEY_SET.has(value) ? value : '';
}

function cleanRoomPresetKey(value) {
  return typeof value === 'string' && ROOM_PRESET_KEY_SET.has(value) ? value : '';
}

function getRoomPreset(value) {
  const key = cleanRoomPresetKey(value);
  return key ? ROOM_PRESETS.find((preset) => preset.key === key) || null : null;
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
  ROOM_EMOJIS,
  ROOM_COLOR_KEYS,
  ROOM_ICON_KEYS,
  ROOM_PRESET_KEYS,
  ROOM_PRESETS,
  SCREEN_PROFILE_IDS,
  cleanAvatarColorKey,
  cleanDisplayName,
  cleanLiveKitUrl,
  cleanName,
  cleanRoomColorKey,
  cleanRoomEmoji,
  cleanRoomIconKey,
  cleanRoomName,
  cleanRoomPresetKey,
  cleanScreenProfileId,
  cleanStreamId,
  getRoomPreset,
  isValidPassword,
  normalizeLogin,
  normalizePeerId,
  normalizeRoomId,
  normalizeSessionToken
};
