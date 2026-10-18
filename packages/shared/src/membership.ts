// Room membership: the page request for a room's member list and building
// the page (its shape is contracts/membership.ts) with each member's role,
// presence and voice state.

import type { MemberPage, MemberPresenceStatus, MembershipMember, MembershipRole } from './contracts/membership.ts';

export const MEMBERSHIP_CONTRACT_VERSION = 1 as const;
export const MEMBERSHIP_DEFAULT_LIMIT = 50 as const;
export const MEMBERSHIP_MAX_LIMIT = 100 as const;
export const MEMBERSHIP_ROLES: readonly MembershipRole[] = Object.freeze(['owner', 'member'] as const);

type Loose = Record<string, unknown>;

const MEMBERSHIP_ROLE_SET = new Set<unknown>(MEMBERSHIP_ROLES);
const MEMBER_PRESENCE_STATUSES: readonly unknown[] = ['online', 'afk', 'dnd', 'offline'];

function isObject(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown, max = 256): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= max ? normalized : '';
}

export function normalizeMembershipLimit(value: unknown, fallback: number = MEMBERSHIP_DEFAULT_LIMIT): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, MEMBERSHIP_MAX_LIMIT);
}

export function normalizeMembershipRequest(value: Loose = {}): {
  contractVersion: 1;
  cursor?: string;
  limit: number;
  query?: string;
} {
  const cursor = cleanString(value.cursor, 4096);
  const query = cleanString(value.query ?? value.q, 80);
  return {
    contractVersion: MEMBERSHIP_CONTRACT_VERSION,
    cursor: cursor || undefined,
    limit: normalizeMembershipLimit(value.limit),
    query: query || undefined
  };
}

export function normalizeMembershipMember(value: unknown): MembershipMember | null {
  if (!isObject(value)) return null;
  const userId = cleanString(value.userId ?? value.id, 36);
  if (!userId) return null;
  const role = MEMBERSHIP_ROLE_SET.has(value.role) ? (value.role as MembershipRole) : 'member';
  const presenceStatus = MEMBER_PRESENCE_STATUSES.includes(value.presenceStatus)
    ? (value.presenceStatus as MemberPresenceStatus)
    : 'offline';
  return {
    userId,
    displayName: cleanString(value.displayName, 120),
    login: cleanString(value.login, 120),
    avatarColorKey: cleanString(value.avatarColorKey, 40),
    avatarUrl: cleanString(value.avatarUrl, 1024) || null,
    avatarAccent: cleanString(value.avatarAccent, 40) || null,
    role,
    joinedAt: value.joinedAt != null && Number.isFinite(Number(value.joinedAt)) ? Number(value.joinedAt) : null,
    inVoice: Boolean(value.inVoice),
    presenceStatus
  };
}

export function buildMembershipEnvelope({
  roomId,
  members = [],
  nextCursor,
  hasMore = false,
  presenceRevision = 0
}: {
  roomId?: unknown;
  members?: unknown[];
  nextCursor?: unknown;
  hasMore?: unknown;
  presenceRevision?: unknown;
} = {}): MemberPage {
  return {
    contractVersion: MEMBERSHIP_CONTRACT_VERSION,
    roomId: cleanString(roomId, 48),
    members: Array.isArray(members)
      ? members.map(normalizeMembershipMember).filter((member): member is MembershipMember => Boolean(member))
      : [],
    pageInfo: {
      nextCursor: cleanString(nextCursor, 4096) || undefined,
      hasMore: Boolean(hasMore)
    },
    presenceRevision: Math.max(0, Number.isSafeInteger(Number(presenceRevision)) ? Number(presenceRevision) : 0)
  };
}
