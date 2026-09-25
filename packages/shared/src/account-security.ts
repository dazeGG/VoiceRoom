// Account security: recovery codes, sign-in alerts, session descriptions,
// the "what's new" announcement, and account deletion.

export interface UserAgentDescription {
  client: string;
  os: string;
}

export interface AccountSession {
  id: string;
  current: boolean;
  client: string;
  os: string;
  location: string;
  lastSeenAt: number;
}

export interface RecoveryCodesStatus {
  remaining: number;
  generatedAt: number | null;
}

export interface RecoveryCodesReminder {
  snoozedUntil: number | null;
}

export interface WhatsNewState {
  current: string;
  lastSeen: string | null;
}

export type LoginAlertKind = 'login' | 'recovery';

export interface LoginAlert {
  id: string;
  kind: LoginAlertKind;
  client: string;
  os: string;
  location: string;
  createdAt: number;
}

/** Facts about the signed-in account that only the account itself receives. */
export interface SelfUserFlags {
  /** The account has signed in from the desktop app at least once. */
  hasUsedDesktopApp: boolean;
  /** The one-time post-registration app prompt was already shown or dismissed. */
  appPromptSeen: boolean;
}

export interface AccountDeletionRoom {
  roomId: string;
  name: string;
  heir: { displayName: string; login: string } | null;
}

export interface AccountDeletionPreview {
  graceDays: number;
  rooms: AccountDeletionRoom[];
}

type Loose = Record<string, unknown>;

export const ACCOUNT_SECURITY_CONTRACT_VERSION = 1 as const;
export const RECOVERY_CODE_COUNT = 10 as const;
export const RECOVERY_CODE_LENGTH = 16 as const;
export const RECOVERY_CODE_GROUP_LENGTH = 4 as const;
// Crockford base32 has no I, L, O or U, so a code copied from paper survives the
// usual look-alike mistakes; 16 symbols carry 80 bits.
export const RECOVERY_CODE_ALPHABET: string = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
// The release whose "what's new" announcement the web client shows. Accounts
// remember the last announcement they saw and new accounts start at this one,
// so only people who used an earlier release are shown it.
export const WHATS_NEW_VERSION: string = '2.6.0';
export const RECOVERY_CODES_REMINDER_SNOOZE_MS: number = 3 * 24 * 60 * 60 * 1000;
// A sign-in from a device and city the account has not used within this window
// asks the account whether it was them; an unanswered question expires after
// the alert TTL.
export const LOGIN_FAMILIARITY_WINDOW_MS: number = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_ALERT_TTL_MS: number = 14 * 24 * 60 * 60 * 1000;
const LOGIN_ALERT_KINDS: readonly LoginAlertKind[] = Object.freeze(['login', 'recovery']);
// An account asked to be deleted stays restorable this long; then its personal
// data goes away and what others still see of it reads as a deleted account.
export const ACCOUNT_DELETION_GRACE_MS: number = 7 * 24 * 60 * 60 * 1000;
export const DELETED_ACCOUNT_NAME: string = 'Удалённый аккаунт';
// Finished deletions free their row's login under this prefix, so no new
// account may take it.
export const DELETED_LOGIN_PREFIX: string = 'deleted-';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;

// Order matters: Chromium-based browsers also carry "Chrome/" and "Safari/",
// and the desktop shell is Electron, which carries both as well.
const CLIENT_RULES: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/VoiceRoom|Electron\//i, 'VoiceRoom Desktop'],
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
  return RELEASE_VERSION_PATTERN.test(version) ? version : '';
}

// -1, 0 or 1 like a sort comparator; null when either side is not a version.
export function compareReleaseVersions(left: unknown, right: unknown): -1 | 0 | 1 | null {
  const a = normalizeReleaseVersion(left);
  const b = normalizeReleaseVersion(right);
  if (!a || !b) return null;
  const leftParts = a.split('.').map(Number);
  const rightParts = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index]! < rightParts[index]! ? -1 : 1;
  }
  return 0;
}

// An account that never recorded an announcement predates them all.
export function hasUnseenWhatsNew(lastSeen: unknown, current: string = WHATS_NEW_VERSION): boolean {
  if (!normalizeReleaseVersion(current)) return false;
  const order = compareReleaseVersions(lastSeen, current);
  return order === null || order < 0;
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

export function normalizeLoginAlert(input: unknown): LoginAlert | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Loose;
  const id = typeof value.id === 'string' && UUID_PATTERN.test(value.id) ? value.id.toLowerCase() : '';
  const kind = (LOGIN_ALERT_KINDS as readonly unknown[]).includes(value.kind) ? (value.kind as LoginAlertKind) : '';
  const createdAt = Number(value.createdAt);
  if (!id || !kind || !Number.isSafeInteger(createdAt) || createdAt < 0) return null;
  return {
    id,
    kind,
    client: boundedText(value.client, 64),
    os: boundedText(value.os, 32),
    location: boundedText(value.location, 120),
    createdAt
  };
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
  return CLIENT_RULES[0]![0].test(userAgent);
}

// Facts about the signed-in account that only the account itself receives.
// An older API sends neither flag: the app banner may then show, but the
// one-time post-registration prompt never does.
export function normalizeSelfUserFlags(value: unknown): SelfUserFlags {
  const source = (value && typeof value === 'object' ? value : {}) as Loose;
  return {
    hasUsedDesktopApp: source.hasUsedDesktopApp === true,
    appPromptSeen: source.appPromptSeen !== false
  };
}

function boundedText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeAccountSession(input: unknown): AccountSession | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Loose;
  const id =
    typeof value.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
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
