// Account security: recovery codes, sign-in alerts, session descriptions,
// the "what's new" announcement, and account deletion.

import type { RecoveryCodesReminder, RecoveryCodesStatus } from './contracts/account.ts';
import type { ClientKind } from './contracts/admin.ts';

export interface UserAgentDescription {
  client: string;
  os: string;
}

export const RECOVERY_CODE_COUNT = 10 as const;
export const RECOVERY_CODE_LENGTH = 16 as const;
export const RECOVERY_CODE_GROUP_LENGTH = 4 as const;
// Crockford base32 has no I, L, O or U, so a code copied from paper survives the
// usual look-alike mistakes; 16 symbols carry 80 bits.
export const RECOVERY_CODE_ALPHABET: string = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
export const RECOVERY_CODES_REMINDER_SNOOZE_MS: number = 3 * 24 * 60 * 60 * 1000;
// A sign-in from a device and city the account has not used within this window
// asks the account whether it was them; an unanswered question expires after
// the alert TTL.
export const LOGIN_FAMILIARITY_WINDOW_MS: number = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_ALERT_TTL_MS: number = 14 * 24 * 60 * 60 * 1000;
// An account asked to be deleted stays restorable this long; then its personal
// data goes away and what others still see of it reads as a deleted account.
export const ACCOUNT_DELETION_GRACE_MS: number = 7 * 24 * 60 * 60 * 1000;
export const DELETED_ACCOUNT_NAME: string = 'Удалённый аккаунт';
// Finished deletions free their row's login under this prefix, so no new
// account may take it.
export const DELETED_LOGIN_PREFIX: string = 'deleted-';
const RELEASE_VERSION_CORE = String.raw`(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)`;
const RELEASE_VERSION_PATTERN = new RegExp(`^${RELEASE_VERSION_CORE}$`);
export const WHATS_NEW_RELEASE_PATTERN = new RegExp(`^web/(${RELEASE_VERSION_CORE})$`);
// The VoiceRoom Android app says "VoiceRoom-Android/<x.y.z>". It is checked before
// the desktop pattern, which also matches "VoiceRoom". client-version.ts writes
// the same pattern, and a shared test pins both to the same user agents.
const MOBILE_APP_PATTERN = /VoiceRoom-Android\//i;

// Order matters: Chromium-based browsers also carry "Chrome/" and "Safari/",
// and the desktop shell is Electron, which carries both as well.
const DESKTOP_APP_PATTERN = /VoiceRoom|Electron\//i;
const CLIENT_RULES: readonly (readonly [RegExp, string])[] = Object.freeze([
  [MOBILE_APP_PATTERN, 'VoiceRoom Android'],
  [DESKTOP_APP_PATTERN, 'VoiceRoom Desktop'],
  [/YaBrowser\//, 'Яндекс Браузер'],
  [/Edg(?:A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari']
]);

// Android user agents also say "Linux", and iPadOS can say "Macintosh".
const OS_RULES: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/Windows/i, 'Windows'],
  [/Android/i, 'Android'],
  [/iPhone|iPad|iPod/i, 'iOS'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/Linux|X11/i, 'Linux']
]);

export function normalizeRecoveryCode(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64) return '';
  const code = value
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return RECOVERY_CODE_PATTERN.test(code) ? code : '';
}

export function formatRecoveryCode(value: unknown): string {
  const code = normalizeRecoveryCode(value);
  if (!code) return '';
  const groups: string[] = [];
  for (let index = 0; index < code.length; index += RECOVERY_CODE_GROUP_LENGTH) {
    groups.push(code.slice(index, index + RECOVERY_CODE_GROUP_LENGTH));
  }
  return groups.join('-');
}

export function normalizeReleaseVersion(value: unknown): string {
  const version = typeof value === 'string' ? value.trim() : '';
  return parseWhatsNewRelease(version) ? version : '';
}

// -1, 0 or 1 like a sort comparator; null when either side is not a version.
export function compareReleaseVersions(left: unknown, right: unknown): -1 | 0 | 1 | null {
  const a = typeof left === 'string' ? left.trim() : '';
  const b = typeof right === 'string' ? right.trim() : '';
  if (!RELEASE_VERSION_PATTERN.test(a) || !RELEASE_VERSION_PATTERN.test(b)) return null;
  const leftParts = a.split('.');
  const rightParts = b.split('.');
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? '';
    const rightPart = rightParts[index] ?? '';
    if (leftPart.length !== rightPart.length) return leftPart.length < rightPart.length ? -1 : 1;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function parseWhatsNewRelease(value: unknown): { app: 'web'; version: string } | 'legacy' | null {
  if (typeof value !== 'string') return null;
  const version = WHATS_NEW_RELEASE_PATTERN.exec(value)?.[1];
  if (version) return { app: 'web', version };
  return RELEASE_VERSION_PATTERN.test(value) ? 'legacy' : null;
}

export function hasUnseenWhatsNew(lastSeen: unknown, current: string): boolean {
  const release = parseWhatsNewRelease(current);
  if (!release || release === 'legacy') return false;
  const seen = parseWhatsNewRelease(lastSeen);
  return !seen || seen === 'legacy' || compareReleaseVersions(seen.version, release.version) === -1;
}

export function isRecoveryCodesReminderDue(
  status: Pick<RecoveryCodesStatus, 'remaining'> | null | undefined,
  reminder: RecoveryCodesReminder | null | undefined,
  now: number = Date.now()
): boolean {
  if (!status || Number(status.remaining) !== 0) return false;
  const snoozedUntil = Number(reminder?.snoozedUntil);
  return !(Number.isFinite(snoozedUntil) && snoozedUntil > now);
}

export function isDeletedAccountLogin(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith(DELETED_LOGIN_PREFIX);
}

export function describeUserAgent(value: unknown): UserAgentDescription {
  const userAgent = typeof value === 'string' ? value.slice(0, 512) : '';
  const match = (rules: readonly (readonly [RegExp, string])[]): string =>
    rules.find(([pattern]) => pattern.test(userAgent))?.[1] || '';
  return { client: match(CLIENT_RULES), os: match(OS_RULES) };
}

// The desktop app is the Electron shell, whose user agent carries "VoiceRoom" or
// "Electron/". Session descriptions and the per-account app marker both use
// this rule, so they can never disagree about who has used the app.
export function isDesktopAppUserAgent(value: unknown): boolean {
  const userAgent = typeof value === 'string' ? value.slice(0, 512) : '';
  return !MOBILE_APP_PATTERN.test(userAgent) && DESKTOP_APP_PATTERN.test(userAgent);
}

/** Null when there is no user agent to tell. */
export function clientKind(userAgent: string | null | undefined): ClientKind | null {
  if (!userAgent) return null;
  if (MOBILE_APP_PATTERN.test(userAgent)) return 'mobile_app';
  if (isDesktopAppUserAgent(userAgent)) return 'desktop_app';
  const { os } = describeUserAgent(userAgent);
  return os === 'Android' || os === 'iOS' ? 'mobile' : 'browser';
}
