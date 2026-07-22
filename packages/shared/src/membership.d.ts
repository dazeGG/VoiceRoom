export const MEMBERSHIP_CONTRACT_VERSION: 1;
export const MEMBERSHIP_DEFAULT_LIMIT: 50;
export const MEMBERSHIP_MAX_LIMIT: 100;
export const MEMBERSHIP_ROLES: readonly ['owner', 'member'];

export type MembershipRole = 'owner' | 'member';
export type MemberPresenceStatus = 'online' | 'afk' | 'dnd' | 'offline';

export interface MembershipMember {
  userId: string;
  displayName: string;
  login: string;
  avatarColorKey: string;
  avatarUrl: string | null;
  avatarAccent: string | null;
  role: MembershipRole;
  joinedAt: number | null;
  inVoice: boolean;
  presenceStatus: MemberPresenceStatus;
}

export interface MembershipEnvelope {
  contractVersion: 1;
  roomId: string;
  members: MembershipMember[];
  pageInfo: { nextCursor?: string; hasMore: boolean };
  presenceRevision: number;
}

export function normalizeMembershipLimit(value: unknown, fallback?: number): number;
export function normalizeMembershipRequest(value?: Record<string, unknown>): {
  contractVersion: 1;
  cursor?: string;
  limit: number;
  query?: string;
};
export function normalizeMembershipMember(value: unknown): MembershipMember | null;
export function buildMembershipEnvelope(input?: {
  roomId?: unknown;
  members?: unknown[];
  nextCursor?: unknown;
  hasMore?: unknown;
  presenceRevision?: unknown;
}): MembershipEnvelope;
export function normalizeMembershipEnvelope(value: unknown):
  | { ok: true; envelope: MembershipEnvelope }
  | { ok: false; code: string };
