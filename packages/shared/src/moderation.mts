// Room bans: how long a ban lasts, what an owner submits to ban someone, and
// the page of active bans with the banned account's profile when it is known.

export type ModerationDuration = '1h' | '1d' | '7d' | 'permanent';
export interface BanMutation {
  userId: string | null;
  guestIp: string | null;
  duration: ModerationDuration;
  reason: string;
}
export interface ActiveBanProfile {
  displayName: string;
  login: string;
  avatarUrl: string | null;
  avatarColorKey: string;
  avatarAccent: string | null;
}
export interface ActiveBan {
  id: string;
  roomId: string;
  subject: { kind: 'account' | 'guest'; userId: string | null; profile?: ActiveBanProfile };
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

type Loose = Record<string, unknown>;

export const MODERATION_CONTRACT_VERSION = 1 as const;
export const MODERATION_DEFAULT_LIMIT = 50 as const;
export const MODERATION_MAX_LIMIT = 100 as const;
export const MODERATION_REASON_MAX_LENGTH = 500 as const;
export const MODERATION_DURATIONS: readonly ['1h', '1d', '7d', 'permanent'] = Object.freeze(['1h', '1d', '7d', 'permanent'] as const);
export const MODERATION_DURATION_MS: Readonly<Record<ModerationDuration, number | null>> = Object.freeze({
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  permanent: null
});

function isRecord(value: unknown): value is Loose {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text.length <= maxLength ? text : '';
}

export function normalizeModerationLimit(value: unknown, fallback: number = MODERATION_DEFAULT_LIMIT): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, MODERATION_MAX_LIMIT);
}

export function normalizeBanDuration(value: unknown): ModerationDuration | null {
  return (MODERATION_DURATIONS as readonly unknown[]).includes(value) ? value as ModerationDuration : null;
}

export function durationToExpiresAt(duration: unknown, now: number = Date.now()): number | null | undefined {
  const normalized = normalizeBanDuration(duration);
  if (!normalized) return undefined;
  const delta = MODERATION_DURATION_MS[normalized];
  return delta == null ? null : Number(now) + delta;
}

export function normalizeBanMutation(value: unknown = {}): BanMutation | null {
  if (!isRecord(value)) return null;
  const userId = cleanString(value.userId, 36);
  const guestIp = userId ? '' : cleanString(value.guestIp, 256);
  const duration = normalizeBanDuration(value.duration);
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if ((!userId && !guestIp) || !duration || reason.length > MODERATION_REASON_MAX_LENGTH) return null;
  return { userId: userId || null, guestIp: guestIp || null, duration, reason };
}

export function normalizeIdempotencyKey(value: unknown): string | null {
  return cleanString(value, 128) || null;
}

export function normalizeModerationPageRequest(value: Loose = {}): { cursor?: string; limit: number } {
  return {
    cursor: cleanString(value.cursor, 4096) || undefined,
    limit: normalizeModerationLimit(value.limit)
  };
}

// Who an account ban is about, so an owner reads a name instead of a user id.
// Optional: bans created before the profile was projected, and guest bans,
// carry none.
function normalizeBanProfile(value: unknown): ActiveBanProfile | null {
  if (!isRecord(value)) return null;
  const login = cleanString(value.login, 64);
  if (!login) return null;
  const avatarUrl = cleanString(value.avatarUrl, 512);
  return {
    displayName: cleanString(value.displayName, 100),
    login,
    avatarUrl: avatarUrl.startsWith('/api/avatars/') ? avatarUrl : null,
    avatarColorKey: cleanString(value.avatarColorKey, 64),
    avatarAccent: cleanString(value.avatarAccent, 64) || null
  };
}

export function normalizeActiveBan(value: unknown): ActiveBan | null {
  if (!isRecord(value)) return null;
  const subject = value.subject as Loose | null | undefined;
  const id = cleanString(value.id, 36);
  const roomId = cleanString(value.roomId, 48);
  const userId = cleanString(subject?.userId ?? value.userId, 36) || null;
  const kind = userId ? 'account' : 'guest';
  const profile = userId ? normalizeBanProfile(subject?.profile) : null;
  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt ?? value.createdAt);
  const expiresAt = value.expiresAt == null ? null : Number(value.expiresAt);
  if (!id || !roomId || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  if (expiresAt != null && !Number.isFinite(expiresAt)) return null;
  return {
    id,
    roomId,
    subject: profile ? { kind, userId, profile } : { kind, userId },
    reason: typeof value.reason === 'string' ? value.reason.slice(0, MODERATION_REASON_MAX_LENGTH) : '',
    createdAt,
    updatedAt,
    expiresAt
  };
}

export function buildModerationPage({ roomId, bans = [], nextCursor, hasMore = false }: {
  roomId?: unknown;
  bans?: unknown[];
  nextCursor?: unknown;
  hasMore?: unknown;
} = {}): ModerationPage {
  return {
    contractVersion: MODERATION_CONTRACT_VERSION,
    roomId: cleanString(roomId, 48),
    bans: Array.isArray(bans) ? bans.map(normalizeActiveBan).filter((ban): ban is ActiveBan => Boolean(ban)) : [],
    pageInfo: {
      nextCursor: cleanString(nextCursor, 4096) || undefined,
      hasMore: Boolean(hasMore)
    }
  };
}
