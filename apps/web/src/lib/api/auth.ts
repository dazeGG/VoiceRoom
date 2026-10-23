// Account auth client. Every request goes through the shared client, so the
// HttpOnly session cookie set by the API rides along (including on /api/rooms,
// which is how a signed-in user's persistent rooms get an owner). Shapes come
// from @voice-room/shared/contracts/account.

import { normalizeReleaseVersion } from '@voice-room/shared/account-security';
import { isUuid } from '@voice-room/shared/validation';
import {
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
  Sessions,
  SessionsRevoked,
  SignedIn,
  WhatsNewAnswer,
  CredentialsBody,
  CurrentPasswordBody,
  PasswordBody,
  ProfileBody,
  RecoverBody,
  RegisterBody,
  type AccountDeletionPreview,
  type AccountSession,
  type LoginAlert,
  type RecoveryCodesReminder,
  type RecoveryCodesStatus,
  type SelfUser,
  type WhatsNew
} from '@voice-room/shared/contracts/account';
import { Done } from '@voice-room/shared/contracts/http';
import {
  BookmarkRoomBody,
  RoomCard,
  RoomList,
  RoomUnbookmarked,
  type LobbyRoom
} from '@voice-room/shared/contracts/rooms';
// Explicit extensions: the release coverage gate (scripts/test/g08-*) loads
// this module in plain Node, without Vite's resolver.
import { api } from './client.ts';

export type AuthUser = SelfUser;

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
      ? await api.post('/api/auth/avatar', SignedIn, body, { fallback })
      : await api.delete('/api/auth/avatar', SignedIn, undefined, { fallback });
  return answer.user;
}

export const uploadUserAvatar = (file: Blob): Promise<AuthUser> => avatarRequest('POST', file);
export const deleteUserAvatar = (): Promise<AuthUser> => avatarRequest('DELETE');

export async function register(input: RegisterBody): Promise<AuthUser> {
  return (await api.post('/api/auth/register', SignedIn, input, { bodySchema: RegisterBody })).user;
}

export async function login(input: CredentialsBody): Promise<AuthUser> {
  return (await api.post('/api/auth/login', SignedIn, input, { bodySchema: CredentialsBody })).user;
}

export async function logout(): Promise<void> {
  await api.post('/api/auth/logout', Done);
}

export async function updateDisplayName(displayName: string): Promise<AuthUser> {
  return (await api.post('/api/auth/profile', SignedIn, { displayName }, { bodySchema: ProfileBody })).user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/api/auth/password', Done, { currentPassword, newPassword }, { bodySchema: PasswordBody });
}

export async function fetchMe(): Promise<AuthUser | null> {
  return (await api.get('/api/auth/me', Me, { fallback: 'Не удалось проверить сессию' })).user;
}

export async function addRoomByCode(code: string): Promise<OwnedRoom> {
  return (await api.post('/api/auth/rooms', RoomCard, { code }, { bodySchema: BookmarkRoomBody })).room;
}

export async function removeRoomFromList(roomId: string): Promise<boolean> {
  const answer = await api.delete(`/api/auth/rooms/${encodeURIComponent(roomId)}`, RoomUnbookmarked, undefined, {
    fallback: 'Не удалось удалить комнату из списка'
  });
  return answer.removed;
}

export async function fetchOwnedRooms(): Promise<OwnedRoom[]> {
  return (await api.get('/api/auth/rooms', RoomList, { fallback: 'Не удалось загрузить комнаты' })).rooms;
}

export type {
  AccountDeletionPreview,
  AccountSession,
  LoginAlert,
  RecoveryCodesReminder,
  RecoveryCodesStatus,
  WhatsNew
};

export interface AccountSecurity {
  recoveryCodes: RecoveryCodesStatus;
  recoveryCodesReminder: RecoveryCodesReminder;
}

export async function fetchAccountSecurity(): Promise<AccountSecurity> {
  const { recoveryCodes, recoveryCodesReminder } = await api.get('/api/auth/security', Security, {
    fallback: 'Не удалось загрузить настройки безопасности'
  });
  return { recoveryCodes, recoveryCodesReminder };
}

export async function snoozeRecoveryCodesReminder(): Promise<RecoveryCodesReminder> {
  return (await api.post('/api/auth/recovery-codes/reminder/snooze', ReminderSnoozed)).recoveryCodesReminder;
}

// Only a well-formed release number is shown or compared.
function readWhatsNew({ whatsNew }: WhatsNewAnswer): WhatsNew {
  return {
    current: normalizeReleaseVersion(whatsNew.current),
    lastSeen: normalizeReleaseVersion(whatsNew.lastSeen) || null
  };
}

export async function fetchWhatsNew(): Promise<WhatsNew> {
  return readWhatsNew(
    await api.get('/api/auth/whats-new', WhatsNewAnswer, { fallback: 'Не удалось загрузить новости' })
  );
}

export async function markWhatsNewSeen(): Promise<void> {
  await api.post('/api/auth/whats-new/seen', WhatsNewAnswer);
}

export async function markAppPromptSeen(): Promise<void> {
  await api.post('/api/auth/app-prompt/seen', AppPromptSeen);
}

// The contract lets any string id and any number through; an alert or device
// without a valid id or time is dropped rather than shown half-empty.
function hasValidTime(time: number): boolean {
  return Number.isSafeInteger(time) && time >= 0;
}

export function isShowableLoginAlert(alert: LoginAlert): boolean {
  return isUuid(alert.id) && hasValidTime(alert.createdAt);
}

export async function fetchLoginAlerts(): Promise<LoginAlert[]> {
  const { alerts } = await api.get('/api/auth/login-alerts', LoginAlerts, {
    fallback: 'Не удалось проверить входы в аккаунт'
  });
  return alerts.filter(isShowableLoginAlert);
}

export async function fetchAccountDeletionPreview(): Promise<AccountDeletionPreview> {
  const { graceDays, rooms } = await api.get('/api/auth/account/deletion', DeletionPreview, {
    fallback: 'Не удалось подготовить удаление аккаунта'
  });
  return { graceDays, rooms };
}

export async function requestAccountDeletion(currentPassword: string): Promise<{ deletionScheduledFor: number }> {
  const { deletionScheduledFor } = await api.post(
    '/api/auth/account/deletion',
    DeletionScheduled,
    { currentPassword },
    { bodySchema: CurrentPasswordBody }
  );
  return { deletionScheduledFor };
}

export async function restoreAccount(input: CredentialsBody): Promise<AuthUser> {
  return (await api.post('/api/auth/account/restore', SignedIn, input, { bodySchema: CredentialsBody })).user;
}

export async function confirmLoginAlert(alertId: string): Promise<void> {
  await api.post(`/api/auth/login-alerts/${encodeURIComponent(alertId)}/confirm`, LoginAlertResolved);
}

export async function denyLoginAlert(
  alertId: string
): Promise<{ sessionEnded: boolean; recoveryCodes: RecoveryCodesStatus }> {
  const answer = await api.post(`/api/auth/login-alerts/${encodeURIComponent(alertId)}/deny`, LoginAlertResolved);
  if (answer.resolution !== 'denied') throw new Error('Не удалось ответить на вход');
  return { sessionEnded: answer.sessionEnded, recoveryCodes: answer.recoveryCodes };
}

export async function fetchAccountSessions(): Promise<AccountSession[]> {
  const { sessions } = await api.get('/api/auth/sessions', Sessions, { fallback: 'Не удалось загрузить устройства' });
  return sessions.filter((session) => isUuid(session.id) && hasValidTime(session.lastSeenAt));
}

export async function revokeAccountSession(sessionId: string): Promise<void> {
  await api.delete(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, Done, undefined, {
    fallback: 'Не удалось завершить сеанс'
  });
}

export async function revokeOtherAccountSessions(): Promise<number> {
  return (await api.post('/api/auth/sessions/revoke-others', SessionsRevoked)).revoked;
}

export async function generateRecoveryCodes(
  currentPassword: string
): Promise<{ codes: string[]; recoveryCodes: RecoveryCodesStatus }> {
  const { codes, recoveryCodes } = await api.post(
    '/api/auth/recovery-codes',
    RecoveryCodesGenerated,
    { currentPassword },
    { bodySchema: CurrentPasswordBody }
  );
  return { codes, recoveryCodes };
}

export async function recoverAccount(input: RecoverBody): Promise<{ user: AuthUser; remaining: number }> {
  const { user, recoveryCodes } = await api.post('/api/auth/recover', Recovered, input, { bodySchema: RecoverBody });
  return { user, remaining: recoveryCodes.remaining };
}
