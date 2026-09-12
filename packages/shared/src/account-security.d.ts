export type OnboardingKey = 'release-2.6.0-recovery-codes';

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

export const ACCOUNT_SECURITY_CONTRACT_VERSION: 1;
export const ONBOARDING_KEYS: readonly OnboardingKey[];
export const RECOVERY_CODES_ONBOARDING_KEY: OnboardingKey;
export const RECOVERY_CODE_ALPHABET: string;
export const RECOVERY_CODE_COUNT: 10;
export const RECOVERY_CODE_GROUP_LENGTH: 4;
export const RECOVERY_CODE_LENGTH: 16;

export function describeUserAgent(value: unknown): UserAgentDescription;
export function formatRecoveryCode(value: unknown): string;
export function normalizeAccountSession(value: unknown): AccountSession | null;
export function normalizeOnboardingKey(value: unknown): OnboardingKey | '';
export function normalizeRecoveryCode(value: unknown): string;
