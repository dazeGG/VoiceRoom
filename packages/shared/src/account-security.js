'use strict';

const ACCOUNT_SECURITY_CONTRACT_VERSION = 1;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 16;
const RECOVERY_CODE_GROUP_LENGTH = 4;
// Crockford base32 has no I, L, O or U, so a code copied from paper survives the
// usual look-alike mistakes; 16 symbols carry 80 bits.
const RECOVERY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
// The release whose "what's new" announcement the web client shows. Accounts
// remember the last announcement they saw and new accounts start at this one,
// so only people who used an earlier release are shown it.
const WHATS_NEW_VERSION = '2.6.0';
const RECOVERY_CODES_REMINDER_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;

// Order matters: Chromium-based browsers also carry "Chrome/" and "Safari/",
// and the desktop shell is Electron, which carries both as well.
const CLIENT_RULES = Object.freeze([
  [/VoiceRoom|Electron\//i, 'VoiceRoom Desktop'],
  [/YaBrowser\//, 'Яндекс Браузер'],
  [/Edg(?:A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari']
]);

// Android user agents also say "Linux", and iPadOS can say "Macintosh".
const OS_RULES = Object.freeze([
  [/Windows/i, 'Windows'],
  [/Android/i, 'Android'],
  [/iPhone|iPad|iPod/i, 'iOS'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/Linux|X11/i, 'Linux']
]);

function normalizeRecoveryCode(value) {
  if (typeof value !== 'string' || value.length > 64) return '';
  const code = value
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return RECOVERY_CODE_PATTERN.test(code) ? code : '';
}

function formatRecoveryCode(value) {
  const code = normalizeRecoveryCode(value);
  if (!code) return '';
  const groups = [];
  for (let index = 0; index < code.length; index += RECOVERY_CODE_GROUP_LENGTH) {
    groups.push(code.slice(index, index + RECOVERY_CODE_GROUP_LENGTH));
  }
  return groups.join('-');
}

function normalizeReleaseVersion(value) {
  const version = typeof value === 'string' ? value.trim() : '';
  return RELEASE_VERSION_PATTERN.test(version) ? version : '';
}

// -1, 0 or 1 like a sort comparator; null when either side is not a version.
function compareReleaseVersions(left, right) {
  const a = normalizeReleaseVersion(left);
  const b = normalizeReleaseVersion(right);
  if (!a || !b) return null;
  const leftParts = a.split('.').map(Number);
  const rightParts = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

// An account that never recorded an announcement predates them all.
function hasUnseenWhatsNew(lastSeen, current = WHATS_NEW_VERSION) {
  if (!normalizeReleaseVersion(current)) return false;
  const order = compareReleaseVersions(lastSeen, current);
  return order === null || order < 0;
}

function isRecoveryCodesReminderDue(status, reminder, now = Date.now()) {
  if (!status || Number(status.remaining) !== 0) return false;
  const snoozedUntil = Number(reminder?.snoozedUntil);
  return !(Number.isFinite(snoozedUntil) && snoozedUntil > now);
}

function describeUserAgent(value) {
  const userAgent = typeof value === 'string' ? value.slice(0, 512) : '';
  const match = (rules) => rules.find(([pattern]) => pattern.test(userAgent))?.[1] || '';
  return { client: match(CLIENT_RULES), os: match(OS_RULES) };
}

function boundedText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeAccountSession(value) {
  if (!value || typeof value !== 'object') return null;
  const id = typeof value.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
    ? value.id.toLowerCase()
    : '';
  const lastSeenAt = Number(value.lastSeenAt);
  if (!id || !Number.isSafeInteger(lastSeenAt) || lastSeenAt < 0) return null;
  return {
    id,
    current: value.current === true,
    client: boundedText(value.client, 64),
    os: boundedText(value.os, 32),
    location: boundedText(value.location, 120),
    lastSeenAt
  };
}

module.exports = {
  ACCOUNT_SECURITY_CONTRACT_VERSION,
  RECOVERY_CODES_REMINDER_SNOOZE_MS,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_GROUP_LENGTH,
  RECOVERY_CODE_LENGTH,
  WHATS_NEW_VERSION,
  compareReleaseVersions,
  describeUserAgent,
  formatRecoveryCode,
  hasUnseenWhatsNew,
  isRecoveryCodesReminderDue,
  normalizeAccountSession,
  normalizeRecoveryCode,
  normalizeReleaseVersion
};
