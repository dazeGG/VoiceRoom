// Room membership: the page request for a room's member list and building
// the page (its shape is contracts/membership.ts) with each member's role,
// presence and voice state.

import type { MemberPage, MemberPresenceStatus, MembershipMember, MembershipRole } from './contracts/membership.ts';
import { isOneOf, isRecord, pageInfoOf, pageLimitOf, trimmedText } from './guards.ts';

const MEMBERSHIP_CONTRACT_VERSION = 1 as const;
export const MEMBERSHIP_DEFAULT_LIMIT = 50 as const;
export const MEMBERSHIP_MAX_LIMIT = 100 as const;
export const MEMBERSHIP_ROLES: readonly MembershipRole[] = Object.freeze(['owner', 'member'] as const);

type Loose = Record<string, unknown>;

const MEMBER_PRESENCE_STATUSES: readonly MemberPresenceStatus[] = ['online', 'afk', 'dnd', 'offline'];

export function normalizeMembershipRequest(value: Loose = {}): {
  contractVersion: 1;
  cursor?: string | undefined;
  limit: number;
  query?: string | undefined;
} {
  const cursor = trimmedText(value.cursor, 4096);
  const query = trimmedText(value.query ?? value.q, 80);
  return {
    contractVersion: MEMBERSHIP_CONTRACT_VERSION,
    cursor: cursor || undefined,
    limit: pageLimitOf(value.limit, MEMBERSHIP_DEFAULT_LIMIT, MEMBERSHIP_MAX_LIMIT),
    query: query || undefined
  };
}

export function normalizeMembershipMember(value: unknown): MembershipMember | null {
  if (!isRecord(value)) return null;
  const userId = trimmedText(value.userId ?? value.id, 36);
  if (!userId) return null;
  const role = isOneOf(MEMBERSHIP_ROLES, value.role) ? value.role : 'member';
  const presenceStatus = isOneOf(MEMBER_PRESENCE_STATUSES, value.presenceStatus) ? value.presenceStatus : 'offline';
  return {
    userId,
    displayName: trimmedText(value.displayName, 120),
    login: trimmedText(value.login, 120),
    avatarColorKey: trimmedText(value.avatarColorKey, 40),
    avatarUrl: trimmedText(value.avatarUrl, 1024) || null,
    avatarAccent: trimmedText(value.avatarAccent, 40) || null,
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
  roomId: string;
  members?: readonly MembershipMember[];
  nextCursor?: string | undefined;
  hasMore?: boolean;
  presenceRevision?: number;
}): MemberPage {
  return {
    contractVersion: MEMBERSHIP_CONTRACT_VERSION,
    roomId: trimmedText(roomId, 48),
    members: members.map(normalizeMembershipMember).filter((member): member is MembershipMember => Boolean(member)),
    pageInfo: pageInfoOf(nextCursor, hasMore),
    presenceRevision: Number.isSafeInteger(presenceRevision) ? Math.max(0, presenceRevision) : 0
  };
}
