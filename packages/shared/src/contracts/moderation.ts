// The room owner's moderation centre: active bans, banning and unbanning an
// account or a guest address, and deleting any message in the room. These
// answers carry a contract version instead of `ok`.

import { Type, type Static } from 'typebox';
import { Nullable } from './http.ts';

export const BanProfile = Type.Object({
  displayName: Type.String(),
  login: Type.String(),
  avatarUrl: Nullable(Type.String()),
  avatarColorKey: Type.String(),
  avatarAccent: Nullable(Type.String())
});

export const Ban = Type.Object({
  id: Type.String(),
  roomId: Type.String(),
  subject: Type.Object({
    kind: Type.Union([Type.Literal('account'), Type.Literal('guest')]),
    userId: Nullable(Type.String()),
    profile: Type.Optional(BanProfile)
  }),
  reason: Type.String(),
  createdAt: Nullable(Type.Number()),
  updatedAt: Nullable(Type.Number()),
  expiresAt: Nullable(Type.Number())
});
export type Ban = Static<typeof Ban>;

export const BansQuery = Type.Object({ cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.String()) });

export const BanPage = Type.Object({
  contractVersion: Type.Literal(1),
  roomId: Type.String(),
  bans: Type.Array(Ban),
  pageInfo: Type.Object({ nextCursor: Type.Optional(Type.String()), hasMore: Type.Boolean() })
});
export type BanPage = Static<typeof BanPage>;

/** Who to ban and for how long; ../moderation.ts normalizeBanMutation checks the rest. */
export const BanBody = Type.Object({
  userId: Type.Optional(Nullable(Type.String())),
  guestIp: Type.Optional(Nullable(Type.String())),
  duration: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String())
});
export type BanBody = Static<typeof BanBody>;

/** Retrying a ban with the same Idempotency-Key answers the first result again. */
export const BanHeaders = Type.Object({ 'idempotency-key': Type.Optional(Type.String()) });

export const BanSaved = Type.Object({
  contractVersion: Type.Literal(1),
  status: Type.Union([Type.Literal('created'), Type.Literal('updated'), Type.Literal('replayed')]),
  ban: Nullable(Ban)
});
export type BanSaved = Static<typeof BanSaved>;

export const BanLifted = Type.Object({
  contractVersion: Type.Literal(1),
  status: Type.Literal('unbanned'),
  ban: Nullable(Ban)
});
export type BanLifted = Static<typeof BanLifted>;

export const ModeratedMessageParams = Type.Object({ roomId: Type.String(), messageId: Type.String() });

export const MessageRemoved = Type.Object({
  contractVersion: Type.Literal(1),
  status: Type.Union([Type.Literal('deleted'), Type.Literal('already_deleted')]),
  deletion: Type.Object({ roomId: Type.String(), messageId: Type.String(), deletedAt: Type.Number() })
});
export type MessageRemoved = Static<typeof MessageRemoved>;
