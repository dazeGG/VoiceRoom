const ACCOUNT_SECURITY_CONTRACT_VERSION = 1;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 16;
const RECOVERY_CODE_GROUP_LENGTH = 4;
// Crockford base32 has no I, L, O or U, so a code copied from paper survives the
// usual look-alike mistakes; 16 symbols carry 80 bits.
const RECOVERY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
const RECOVERY_CODES_ONBOARDING_KEY = 'release-2.6.0-recovery-codes';
const ONBOARDING_KEYS = Object.freeze([RECOVERY_CODES_ONBOARDING_KEY]);

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

function normalizeOnboardingKey(value) {
  return typeof value === 'string' && ONBOARDING_KEYS.includes(value) ? value : '';
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

export {
  ACCOUNT_SECURITY_CONTRACT_VERSION,
  ONBOARDING_KEYS,
  RECOVERY_CODES_ONBOARDING_KEY,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_GROUP_LENGTH,
  RECOVERY_CODE_LENGTH,
  describeUserAgent,
  formatRecoveryCode,
  normalizeAccountSession,
  normalizeOnboardingKey,
  normalizeRecoveryCode
};
