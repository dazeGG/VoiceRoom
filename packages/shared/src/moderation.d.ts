export const MODERATION_CONTRACT_VERSION: 1;
export const MODERATION_DEFAULT_LIMIT: 50;
export const MODERATION_MAX_LIMIT: 100;
export const MODERATION_REASON_MAX_LENGTH: 500;
export const MODERATION_DURATIONS: readonly ['1h', '1d', '7d', 'permanent'];
export const MODERATION_DURATION_MS: Readonly<Record<ModerationDuration, number | null>>;

export type ModerationDuration = '1h' | '1d' | '7d' | 'permanent';
export interface BanMutation {
  userId: string | null;
  guestIp: string | null;
  duration: ModerationDuration;
  reason: string;
}
export interface ActiveBan {
  id: string;
  roomId: string;
  subject: { kind: 'account' | 'guest'; userId: string | null };
  reason: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}
export interface ModerationPage {
  contractVersion: 1;
  roomId: string;
  bans: ActiveBan[];
  pageInfo: { nextCursor?: string; hasMore: boolean };
}

export function normalizeModerationLimit(value: unknown, fallback?: number): number;
export function normalizeBanDuration(value: unknown): ModerationDuration | null;
export function durationToExpiresAt(duration: unknown, now?: number): number | null | undefined;
export function normalizeBanMutation(value?: unknown): BanMutation | null;
export function normalizeIdempotencyKey(value: unknown): string | null;
export function normalizeModerationPageRequest(value?: Record<string, unknown>): { cursor?: string; limit: number };
export function normalizeActiveBan(value: unknown): ActiveBan | null;
export function buildModerationPage(input?: {
  roomId?: unknown;
  bans?: unknown[];
  nextCursor?: unknown;
  hasMore?: unknown;
}): ModerationPage;
