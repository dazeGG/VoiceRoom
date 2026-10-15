// How one account appears to another: the public profile every list, search
// and notification carries. Never the password hash, never self-only flags.

import { Type, type Static } from 'typebox';
import { Nullable } from './http.ts';

export const PresenceStatus = Type.Union([
  Type.Literal('online'),
  Type.Literal('away'),
  Type.Literal('dnd'),
  Type.Literal('offline')
]);
export type PresenceStatus = Static<typeof PresenceStatus>;

/** The mark next to an account's name: the service's own account, or (later) a verified person. */
export const AccountBadge = Type.Union([Type.Literal('official'), Type.Literal('verified')]);
export type AccountBadge = Static<typeof AccountBadge>;

/** GET /api/badges: the few accounts that carry a mark; clients look names up by id. */
export const BadgeList = Type.Object({
  ok: Type.Literal(true),
  badges: Type.Array(Type.Object({ userId: Type.String(), badge: AccountBadge }))
});
export type BadgeList = Static<typeof BadgeList>;

export const PublicUser = Type.Object({
  avatarAccent: Nullable(Type.String()),
  avatarColorKey: Type.String(),
  avatarUrl: Nullable(Type.String()),
  /** Null only for rows read before the column had a value. */
  createdAt: Nullable(Type.Number()),
  displayName: Type.String(),
  /** Older name of `doNotDisturb`, still sent where the account store builds the profile. */
  dnd: Type.Optional(Type.Boolean()),
  doNotDisturb: Type.Boolean(),
  id: Type.String(),
  login: Type.String(),
  presenceStatus: PresenceStatus
});
export type PublicUser = Static<typeof PublicUser>;
