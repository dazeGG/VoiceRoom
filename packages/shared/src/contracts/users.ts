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
