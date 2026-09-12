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

export const ACCOUNT_SECURITY_CONTRACT_VERSION: 1;
export const RECOVERY_CODES_REMINDER_SNOOZE_MS: number;
export const RECOVERY_CODE_ALPHABET: string;
export const RECOVERY_CODE_COUNT: 10;
export const RECOVERY_CODE_GROUP_LENGTH: 4;
export const RECOVERY_CODE_LENGTH: 16;
export const WHATS_NEW_VERSION: string;

export function compareReleaseVersions(left: unknown, right: unknown): -1 | 0 | 1 | null;
export function describeUserAgent(value: unknown): UserAgentDescription;
export function formatRecoveryCode(value: unknown): string;
export function hasUnseenWhatsNew(lastSeen: unknown, current?: string): boolean;
export function isRecoveryCodesReminderDue(
  status: Pick<RecoveryCodesStatus, 'remaining'> | null | undefined,
  reminder: RecoveryCodesReminder | null | undefined,
  now?: number
): boolean;
export function normalizeAccountSession(value: unknown): AccountSession | null;
export function normalizeRecoveryCode(value: unknown): string;
export function normalizeReleaseVersion(value: unknown): string;
