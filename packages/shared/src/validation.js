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
  SCREEN_PROFILE_IDS,
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl
};
