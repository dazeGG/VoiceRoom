import { Type, type Static } from 'typebox';
import { Ok } from './http.ts';
import { PublicUser, UserId } from './users.ts';

export const ContactAudience = Type.Union([
  Type.Literal('everyone'),
  Type.Literal('friends'),
  Type.Literal('selected')
]);
export type ContactAudience = Static<typeof ContactAudience>;

export const ContactKind = Type.Union([Type.Literal('messages'), Type.Literal('calls')]);
export type ContactKind = Static<typeof ContactKind>;

export const ContactDecision = Type.Union([
  Type.Literal('allowed'),
  Type.Literal('blocked'),
  Type.Literal('friends_only'),
  Type.Literal('not_selected'),
  Type.Literal('chat_cap'),
  Type.Literal('unanswered_cap')
]);
export type ContactDecision = Static<typeof ContactDecision>;

export const PrivacySettings = Type.Object({ messagesFrom: ContactAudience, callsFrom: ContactAudience });
export type PrivacySettings = Static<typeof PrivacySettings>;

export const ContactAllowEntry = Type.Object({ kind: ContactKind, user: PublicUser, createdAt: Type.Number() });
export type ContactAllowEntry = Static<typeof ContactAllowEntry>;

export const AccountPrivacy = Type.Object({ ...PrivacySettings.properties, allowList: Type.Array(ContactAllowEntry) });
export type AccountPrivacy = Static<typeof AccountPrivacy>;

export const PrivacyResponse = Ok({ privacy: AccountPrivacy });
export type PrivacyResponse = Static<typeof PrivacyResponse>;
export const PrivacyAllowParams = Type.Object({ kind: ContactKind, userId: UserId });
