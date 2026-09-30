// A room's member directory and leaving a room. The member page is the
// envelope in ../membership.ts (no `ok` field: it predates the HTTP envelope).

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

export const MembershipMember = Type.Object({
  userId: Type.String(),
  displayName: Type.String(),
  login: Type.String(),
  avatarColorKey: Type.String(),
  avatarUrl: Nullable(Type.String()),
  avatarAccent: Nullable(Type.String()),
  role: Type.Union([Type.Literal('owner'), Type.Literal('member')]),
  joinedAt: Nullable(Type.Number()),
  inVoice: Type.Boolean(),
  presenceStatus: Type.Union([
    Type.Literal('online'),
    Type.Literal('afk'),
    Type.Literal('dnd'),
    Type.Literal('offline')
  ])
});

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
