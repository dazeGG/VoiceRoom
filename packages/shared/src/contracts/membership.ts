// A room's member directory and leaving a room. The member page carries a
// contract version instead of `ok` (it predates the HTTP envelope); ../membership.ts
// builds it.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';
import type { PresenceStatus } from './users.ts';

export const MembershipRole = Type.Union([Type.Literal('owner'), Type.Literal('member')]);
export type MembershipRole = Static<typeof MembershipRole>;

/** The member list says 'afk' where every other payload says 'away'; see the two mappings below. */
export const MemberPresenceStatus = Type.Union([
  Type.Literal('online'),
  Type.Literal('afk'),
  Type.Literal('dnd'),
  Type.Literal('offline')
]);
export type MemberPresenceStatus = Static<typeof MemberPresenceStatus>;

/** An account's presence as the member list sends it. */
export function memberPresenceStatus(status: PresenceStatus): MemberPresenceStatus {
  return status === 'away' ? 'afk' : status;
}

/** A member list entry's presence in the words every other payload uses. */
export function presenceOfMember(status: MemberPresenceStatus): PresenceStatus {
  return status === 'afk' ? 'away' : status;
}

export const MembershipMember = Type.Object({
  userId: Type.String(),
  displayName: Type.String(),
  login: Type.String(),
  avatarColorKey: Type.String(),
  avatarUrl: Nullable(Type.String()),
  avatarAccent: Nullable(Type.String()),
  role: MembershipRole,
  joinedAt: Nullable(Type.Number()),
  inVoice: Type.Boolean(),
  presenceStatus: MemberPresenceStatus
});
export type MembershipMember = Static<typeof MembershipMember>;

export const MemberPage = Type.Object({
  contractVersion: Type.Literal(1),
  roomId: Type.String(),
  members: Type.Array(MembershipMember),
  pageInfo: Type.Object({ nextCursor: Type.Optional(Type.String()), hasMore: Type.Boolean() }),
  presenceRevision: Type.Number()
});
export type MemberPage = Static<typeof MemberPage>;

/** `q` is the search text; `query` is its older name. */
export const MembersQuery = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  q: Type.Optional(Type.String()),
  query: Type.Optional(Type.String())
});

/** `left` is false when the membership was already gone (a retried leave). */
export const MembershipLeft = Ok({ left: Type.Boolean() });
export type MembershipLeft = Static<typeof MembershipLeft>;
