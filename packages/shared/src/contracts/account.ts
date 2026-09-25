// /api/auth/*: signing in and out, recovery, and the signed-in account's own
// settings, devices, sign-in alerts, notices and deletion.

import { Type, type Static } from 'typebox';
import { Failure, Nullable, Ok } from './http.ts';
import { PublicUser } from './users.ts';

/** The signed-in account as it sees itself: the public profile plus facts only it receives. */
export const SelfUser = Type.Object({
  ...PublicUser.properties,
  /** The account has signed in from the desktop app at least once. */
  hasUsedDesktopApp: Type.Boolean(),
  /** The one-time post-registration app prompt was already shown or dismissed. */
  appPromptSeen: Type.Boolean()
});
export type SelfUser = Static<typeof SelfUser>;

/** An account failure; a sign-in to an account waiting for deletion says when it goes. */
export const AccountFailure = Type.Object({
  ...Failure.properties,
  deletionScheduledFor: Type.Optional(Type.Number())
});
export type AccountFailure = Static<typeof AccountFailure>;

export const SignedIn = Ok({ user: SelfUser });
export type SignedIn = Static<typeof SignedIn>;

export const Me = Ok({ user: Nullable(SelfUser) });
export type Me = Static<typeof Me>;

export const RecoveryCodesStatus = Type.Object({ remaining: Type.Number(), generatedAt: Nullable(Type.Number()) });
export type RecoveryCodesStatus = Static<typeof RecoveryCodesStatus>;

export const RecoveryCodesReminder = Type.Object({ snoozedUntil: Nullable(Type.Number()) });
export type RecoveryCodesReminder = Static<typeof RecoveryCodesReminder>;

export const Recovered = Ok({ user: SelfUser, recoveryCodes: Type.Object({ remaining: Type.Number() }) });
export type Recovered = Static<typeof Recovered>;

export const Security = Ok({ recoveryCodes: RecoveryCodesStatus, recoveryCodesReminder: RecoveryCodesReminder });
export type Security = Static<typeof Security>;

export const RecoveryCodesGenerated = Ok({ codes: Type.Array(Type.String()), recoveryCodes: RecoveryCodesStatus });
export type RecoveryCodesGenerated = Static<typeof RecoveryCodesGenerated>;

export const ReminderSnoozed = Ok({ recoveryCodesReminder: RecoveryCodesReminder });
export type ReminderSnoozed = Static<typeof ReminderSnoozed>;

export const AccountSession = Type.Object({
  id: Type.String(),
  current: Type.Boolean(),
  client: Type.String(),
  os: Type.String(),
  location: Type.String(),
  lastSeenAt: Nullable(Type.Number())
});
export type AccountSession = Static<typeof AccountSession>;

export const Sessions = Ok({ sessions: Type.Array(AccountSession) });
export type Sessions = Static<typeof Sessions>;

export const SessionsRevoked = Ok({ revoked: Type.Number() });
export type SessionsRevoked = Static<typeof SessionsRevoked>;

export const WhatsNew = Type.Object({ current: Type.String(), lastSeen: Nullable(Type.String()) });
export type WhatsNew = Static<typeof WhatsNew>;

export const WhatsNewAnswer = Ok({ whatsNew: WhatsNew });
export type WhatsNewAnswer = Static<typeof WhatsNewAnswer>;

export const AppPromptSeen = Ok({ appPromptSeen: Type.Literal(true) });
export type AppPromptSeen = Static<typeof AppPromptSeen>;

export const LoginAlert = Type.Object({
  id: Type.String(),
  kind: Type.Union([Type.Literal('login'), Type.Literal('recovery')]),
  client: Type.String(),
  os: Type.String(),
  location: Type.String(),
  createdAt: Nullable(Type.Number())
});
export type LoginAlert = Static<typeof LoginAlert>;

export const LoginAlerts = Ok({ alerts: Type.Array(LoginAlert) });
export type LoginAlerts = Static<typeof LoginAlerts>;

/** "Это я" closes the question; "Это не я" also ends that session. */
export const LoginAlertResolved = Type.Union([
  Ok({ resolution: Type.Literal('confirmed') }),
  Ok({ resolution: Type.Literal('denied'), sessionEnded: Type.Boolean(), recoveryCodes: RecoveryCodesStatus })
]);
export type LoginAlertResolved = Static<typeof LoginAlertResolved>;

export const DeletionRoom = Type.Object({
  roomId: Type.String(),
  name: Type.String(),
  /** Who inherits the room; null when nobody is left to take it. */
  heir: Nullable(Type.Object({ displayName: Type.String(), login: Type.String() }))
});
export type DeletionRoom = Static<typeof DeletionRoom>;

export const DeletionPreview = Ok({ graceDays: Type.Number(), rooms: Type.Array(DeletionRoom) });
export type DeletionPreview = Static<typeof DeletionPreview>;

export const DeletionScheduled = Ok({ deletionScheduledFor: Type.Number() });
export type DeletionScheduled = Static<typeof DeletionScheduled>;

export const RegisterBody = Type.Object({
  login: Type.Optional(Type.String()),
  displayName: Type.Optional(Type.String()),
  password: Type.Optional(Type.String()),
  passwordConfirm: Type.Optional(Type.String())
});
export type RegisterBody = Static<typeof RegisterBody>;

export const CredentialsBody = Type.Object({
  login: Type.Optional(Type.String()),
  password: Type.Optional(Type.String())
});
export type CredentialsBody = Static<typeof CredentialsBody>;

export const RecoverBody = Type.Object({
  login: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  newPassword: Type.Optional(Type.String())
});
export type RecoverBody = Static<typeof RecoverBody>;

export const ProfileBody = Type.Object({ displayName: Type.Optional(Type.String()) });
export type ProfileBody = Static<typeof ProfileBody>;

export const PasswordBody = Type.Object({
  currentPassword: Type.Optional(Type.String()),
  newPassword: Type.Optional(Type.String())
});
export type PasswordBody = Static<typeof PasswordBody>;

/** Actions the account password guards: new recovery codes, deletion. */
export const CurrentPasswordBody = Type.Object({ currentPassword: Type.Optional(Type.String()) });
export type CurrentPasswordBody = Static<typeof CurrentPasswordBody>;

export const SessionIdParams = Type.Object({ sessionId: Type.String() });
export const AlertIdParams = Type.Object({ alertId: Type.String() });
