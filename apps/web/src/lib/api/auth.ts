// Account auth client. Every request goes through the shared client, so the
// HttpOnly session cookie set by the API rides along (including on /api/rooms,
// which is how a signed-in user's persistent rooms get an owner). Shapes come
// from @voice-room/shared/contracts/account.

import {
  normalizeAccountSession,
  normalizeLoginAlert,
  normalizeReleaseVersion,
  type AccountDeletionPreview,
  type AccountSession,
  type LoginAlert,
  type RecoveryCodesReminder,
  type RecoveryCodesStatus,
  type WhatsNewState
} from '@voice-room/shared/account-security';
import type {
  AppPromptSeen,
  DeletionPreview,
  DeletionScheduled,
  LoginAlertResolved,
  LoginAlerts,
  Me,
  Recovered,
  RecoveryCodesGenerated,
  ReminderSnoozed,
  Security,
  SelfUser,
  Sessions,
  SessionsRevoked,
  SignedIn,
  WhatsNewAnswer
} from '@voice-room/shared/contracts/account';
import type { Done } from '@voice-room/shared/contracts/http';
import type { LobbyRoom, RoomCard, RoomList, RoomUnbookmarked } from '@voice-room/shared/contracts/rooms';
// Explicit extensions: the release coverage gate (scripts/test/g08-*) loads
// this module in plain Node, without Vite's resolver.
import { api } from './client.ts';

export type AuthUser = SelfUser;

export type RoomRelationship = 'owner' | 'bookmarked';

/** A room on the account's list: the lobby card. */
export type OwnedRoom = LobbyRoom;

async function avatarRequest(method: 'POST' | 'DELETE', file?: Blob): Promise<AuthUser> {
  let body: FormData | undefined;
  if (file) {
    body = new FormData();
    body.append('avatar', file, 'avatar.webp');
  }
  const fallback = 'Не удалось обновить аватар';
  const answer =
    method === 'POST'
      ? await api.post<SignedIn>('/api/auth/avatar', body, { fallback })
      : await api.delete<SignedIn>('/api/auth/avatar', undefined, { fallback });
  return answer.user;
}

export const uploadUserAvatar = (file: Blob): Promise<AuthUser> => avatarRequest('POST', file);
export const deleteUserAvatar = (): Promise<AuthUser> => avatarRequest('DELETE');

export interface Credentials {
  login: string;
  password: string;
}

export interface RegisterInput extends Credentials {
  displayName?: string;
  passwordConfirm?: string;
}

export async function register(input: RegisterInput): Promise<AuthUser> {
  return (await api.post<SignedIn>('/api/auth/register', input)).user;
}

export async function login(input: Credentials): Promise<AuthUser> {
  return (await api.post<SignedIn>('/api/auth/login', input)).user;
}

export async function logout(): Promise<void> {
  await api.post<Done>('/api/auth/logout');
}

export async function updateDisplayName(displayName: string): Promise<AuthUser> {
  return (await api.post<SignedIn>('/api/auth/profile', { displayName })).user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post<Done>('/api/auth/password', { currentPassword, newPassword });
}

export async function fetchMe(): Promise<AuthUser | null> {
  return (await api.get<Me>('/api/auth/me', { fallback: 'Не удалось проверить сессию' })).user;
}

export async function addRoomByCode(code: string): Promise<OwnedRoom> {
  return (await api.post<RoomCard>('/api/auth/rooms', { code })).room;
}

export async function removeRoomFromList(roomId: string): Promise<boolean> {
  const answer = await api.delete<RoomUnbookmarked>(`/api/auth/rooms/${encodeURIComponent(roomId)}`, undefined, {
    fallback: 'Не удалось удалить комнату из списка'
  });
  return answer.removed;
}

export async function fetchOwnedRooms(): Promise<OwnedRoom[]> {
  return (await api.get<RoomList>('/api/auth/rooms', { fallback: 'Не удалось загрузить комнаты' })).rooms;
}

export type {
  AccountDeletionPreview,
  AccountSession,
  LoginAlert,
  RecoveryCodesReminder,
  RecoveryCodesStatus,
  WhatsNewState
};

export interface AccountSecurity {
  recoveryCodes: RecoveryCodesStatus;
  recoveryCodesReminder: RecoveryCodesReminder;
}

export interface RecoverInput {
  login: string;
  code: string;
  newPassword: string;
}

export async function fetchAccountSecurity(): Promise<AccountSecurity> {
  const { recoveryCodes, recoveryCodesReminder } = await api.get<Security>('/api/auth/security', {
    fallback: 'Не удалось загрузить настройки безопасности'
  });
  return { recoveryCodes, recoveryCodesReminder };
}

export async function snoozeRecoveryCodesReminder(): Promise<RecoveryCodesReminder> {
  return (await api.post<ReminderSnoozed>('/api/auth/recovery-codes/reminder/snooze')).recoveryCodesReminder;
}

// Only a well-formed release number is shown or compared.
function readWhatsNew({ whatsNew }: WhatsNewAnswer): WhatsNewState {
  return {
    current: normalizeReleaseVersion(whatsNew.current),
    lastSeen: normalizeReleaseVersion(whatsNew.lastSeen) || null
  };
}

export async function fetchWhatsNew(): Promise<WhatsNewState> {
  return readWhatsNew(
    await api.get<WhatsNewAnswer>('/api/auth/whats-new', { fallback: 'Не удалось загрузить новости' })
  );
}

export async function markWhatsNewSeen(): Promise<void> {
  await api.post<WhatsNewAnswer>('/api/auth/whats-new/seen');
}

export async function markAppPromptSeen(): Promise<void> {
  await api.post<AppPromptSeen>('/api/auth/app-prompt/seen');
}

// Alerts and sessions go through the shared normalizers: an entry without a
// valid id or time is dropped rather than shown half-empty.
export async function fetchLoginAlerts(): Promise<LoginAlert[]> {
  const { alerts } = await api.get<LoginAlerts>('/api/auth/login-alerts', {
    fallback: 'Не удалось проверить входы в аккаунт'
  });
  return alerts.map(normalizeLoginAlert).filter((alert): alert is LoginAlert => alert !== null);
}

export async function fetchAccountDeletionPreview(): Promise<AccountDeletionPreview> {
  const { graceDays, rooms } = await api.get<DeletionPreview>('/api/auth/account/deletion', {
    fallback: 'Не удалось подготовить удаление аккаунта'
  });
  return { graceDays, rooms };
}

export async function requestAccountDeletion(currentPassword: string): Promise<{ deletionScheduledFor: number }> {
  const { deletionScheduledFor } = await api.post<DeletionScheduled>('/api/auth/account/deletion', { currentPassword });
  return { deletionScheduledFor };
}

export async function restoreAccount(input: Credentials): Promise<AuthUser> {
  return (await api.post<SignedIn>('/api/auth/account/restore', input)).user;
}

export async function confirmLoginAlert(alertId: string): Promise<void> {
  await api.post<LoginAlertResolved>(`/api/auth/login-alerts/${encodeURIComponent(alertId)}/confirm`);
}

export async function denyLoginAlert(
  alertId: string
): Promise<{ sessionEnded: boolean; recoveryCodes: RecoveryCodesStatus }> {
  const answer = await api.post<LoginAlertResolved>(`/api/auth/login-alerts/${encodeURIComponent(alertId)}/deny`);
  if (answer.resolution !== 'denied') throw new Error('Не удалось ответить на вход');
  return { sessionEnded: answer.sessionEnded, recoveryCodes: answer.recoveryCodes };
}

export async function fetchAccountSessions(): Promise<AccountSession[]> {
  const { sessions } = await api.get<Sessions>('/api/auth/sessions', { fallback: 'Не удалось загрузить устройства' });
  return sessions.map(normalizeAccountSession).filter((session): session is AccountSession => session !== null);
}

export async function revokeAccountSession(sessionId: string): Promise<void> {
  await api.delete<Done>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, undefined, {
    fallback: 'Не удалось завершить сеанс'
  });
}

export async function revokeOtherAccountSessions(): Promise<number> {
  return (await api.post<SessionsRevoked>('/api/auth/sessions/revoke-others')).revoked;
}

export async function generateRecoveryCodes(
  currentPassword: string
): Promise<{ codes: string[]; recoveryCodes: RecoveryCodesStatus }> {
  const { codes, recoveryCodes } = await api.post<RecoveryCodesGenerated>('/api/auth/recovery-codes', {
    currentPassword
  });
  return { codes, recoveryCodes };
}

export async function recoverAccount(input: RecoverInput): Promise<{ user: AuthUser; remaining: number }> {
  const { user, recoveryCodes } = await api.post<Recovered>('/api/auth/recover', input);
  return { user, remaining: recoveryCodes.remaining };
}
