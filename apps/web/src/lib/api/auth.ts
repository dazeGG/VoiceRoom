// Account auth client. All requests are same-origin, so the HttpOnly session
// cookie set by the API rides along automatically (including on /api/rooms,
// which is how a logged-in user's persistent rooms get an owner).

import type { PresenceStatus } from '$lib/shared/presence';
import {
  normalizeAccountSession,
  normalizeLoginAlert,
  normalizeReleaseVersion,
  type AccountDeletionPreview,
  type AccountDeletionRoom,
  type AccountSession,
  type LoginAlert,
  type RecoveryCodesReminder,
  type RecoveryCodesStatus,
  type WhatsNewState
} from '@voice-room/shared/account-security';

export interface AuthUser {
  avatarAccent: string | null;
  avatarColorKey: string;
  avatarUrl: string | null;
  createdAt: number;
  displayName: string;
  dnd: boolean;
  doNotDisturb: boolean;
  id: string;
  login: string;
  presenceStatus: PresenceStatus;
}

export type RoomRelationship = 'owner' | 'bookmarked';

export interface OwnedRoom {
  avatarUrl: string | null;
  createdAt: number;
  emptySince: number | null;
  isStatic: boolean;
  name: string;
  peers: number;
  relationship: RoomRelationship;
  roomId: string;
  unreadCount?: number;
}

async function avatarRequest(path: string, method: 'POST' | 'DELETE', file?: Blob): Promise<AuthUser> {
  const body = file ? new FormData() : undefined;
  if (body && file) body.append('avatar', file, 'avatar.webp');
  const response = await fetch(`/api${path}`, { method, body, credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Не удалось обновить аватар');
  return payload.user;
}

export const uploadUserAvatar = (file: Blob): Promise<AuthUser> => avatarRequest('/auth/avatar', 'POST', file);
export const deleteUserAvatar = (): Promise<AuthUser> => avatarRequest('/auth/avatar', 'DELETE');

export interface Credentials {
  login: string;
  password: string;
}

export interface RegisterInput extends Credentials {
  displayName?: string;
  passwordConfirm?: string;
}

async function authPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    method: 'POST'
  });

  let payload: ({ error?: string; code?: string } & Record<string, unknown>) | null = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error bodies fall through to the generic message.
  }

  if (!response.ok) {
    throw new AuthRequestError(payload?.error || 'Сервер недоступен', payload?.code || '', payload || {});
  }
  return payload as T;
}

// Carries the machine-readable code and extra fields some auth answers need,
// such as when a sign-in hits an account that is waiting to be deleted.
export class AuthRequestError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(message: string, code: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'AuthRequestError';
    this.code = code;
    this.details = details;
  }
}

export async function register(input: RegisterInput): Promise<AuthUser> {
  const payload = await authPost<{ user: AuthUser }>('/auth/register', input);
  return payload.user;
}

export async function login(input: Credentials): Promise<AuthUser> {
  const payload = await authPost<{ user: AuthUser }>('/auth/login', input);
  return payload.user;
}

export async function logout(): Promise<void> {
  await authPost('/auth/logout', {});
}

export async function updateDisplayName(displayName: string): Promise<AuthUser> {
  const payload = await authPost<{ user: AuthUser }>('/auth/profile', { displayName });
  return payload.user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authPost('/auth/password', { currentPassword, newPassword });
}

export async function fetchMe(): Promise<AuthUser | null> {
  const response = await fetch('/api/auth/me', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error('Не удалось проверить сессию');
  }
  const payload = (await response.json()) as { user: AuthUser | null };
  return payload.user ?? null;
}

export async function addRoomByCode(code: string): Promise<OwnedRoom> {
  const payload = await authPost<{ room: OwnedRoom }>('/auth/rooms', { code });
  return payload.room;
}

export async function removeRoomFromList(roomId: string): Promise<boolean> {
  const response = await fetch(`/api/auth/rooms/${encodeURIComponent(roomId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; removed?: boolean };
  if (!response.ok) throw new Error(payload.error || 'Не удалось удалить комнату из списка');
  return Boolean(payload.removed);
}

export async function fetchOwnedRooms(): Promise<OwnedRoom[]> {
  const response = await fetch('/api/auth/rooms', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error('Не удалось загрузить комнаты');
  }
  const payload = (await response.json()) as { rooms?: OwnedRoom[] };
  return Array.isArray(payload.rooms) ? payload.rooms : [];
}

export type {
  AccountDeletionPreview,
  AccountDeletionRoom,
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

async function authRead<T>(path: string, method: 'GET' | 'DELETE', fallbackError: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || fallbackError);
  return payload;
}

function readRecoveryCodesStatus(value: Partial<RecoveryCodesStatus> | undefined): RecoveryCodesStatus {
  return {
    remaining: Math.max(0, Number(value?.remaining) || 0),
    generatedAt: typeof value?.generatedAt === 'number' ? value.generatedAt : null
  };
}

function readRecoveryCodesReminder(value: Partial<RecoveryCodesReminder> | undefined): RecoveryCodesReminder {
  const snoozedUntil = Number(value?.snoozedUntil);
  return { snoozedUntil: Number.isFinite(snoozedUntil) && snoozedUntil > 0 ? snoozedUntil : null };
}

export async function fetchAccountSecurity(): Promise<AccountSecurity> {
  const payload = await authRead<{
    recoveryCodes?: RecoveryCodesStatus;
    recoveryCodesReminder?: Partial<RecoveryCodesReminder>;
  }>('/auth/security', 'GET', 'Не удалось загрузить настройки безопасности');
  return {
    recoveryCodes: readRecoveryCodesStatus(payload.recoveryCodes),
    recoveryCodesReminder: readRecoveryCodesReminder(payload.recoveryCodesReminder)
  };
}

export async function snoozeRecoveryCodesReminder(): Promise<RecoveryCodesReminder> {
  const payload = await authPost<{ recoveryCodesReminder?: Partial<RecoveryCodesReminder> }>(
    '/auth/recovery-codes/reminder/snooze',
    {}
  );
  return readRecoveryCodesReminder(payload.recoveryCodesReminder);
}

export async function fetchWhatsNew(): Promise<WhatsNewState> {
  const payload = await authRead<{ whatsNew?: Partial<WhatsNewState> }>('/auth/whats-new', 'GET', 'Не удалось загрузить новости');
  return {
    current: normalizeReleaseVersion(payload.whatsNew?.current),
    lastSeen: normalizeReleaseVersion(payload.whatsNew?.lastSeen) || null
  };
}

export async function markWhatsNewSeen(): Promise<void> {
  await authPost('/auth/whats-new/seen', {});
}

export async function fetchLoginAlerts(): Promise<LoginAlert[]> {
  const payload = await authRead<{ alerts?: unknown[] }>('/auth/login-alerts', 'GET', 'Не удалось проверить входы в аккаунт');
  return (Array.isArray(payload.alerts) ? payload.alerts : [])
    .map(normalizeLoginAlert)
    .filter((alert): alert is LoginAlert => alert !== null);
}

export async function fetchAccountDeletionPreview(): Promise<AccountDeletionPreview> {
  const payload = await authRead<{ graceDays?: number; rooms?: AccountDeletionRoom[] }>(
    '/auth/account/deletion',
    'GET',
    'Не удалось подготовить удаление аккаунта'
  );
  return {
    graceDays: Math.max(1, Number(payload.graceDays) || 7),
    rooms: Array.isArray(payload.rooms) ? payload.rooms : []
  };
}

export async function requestAccountDeletion(currentPassword: string): Promise<{ deletionScheduledFor: number }> {
  const payload = await authPost<{ deletionScheduledFor?: number }>('/auth/account/deletion', { currentPassword });
  return { deletionScheduledFor: Number(payload.deletionScheduledFor) || Date.now() };
}

export async function restoreAccount(input: Credentials): Promise<AuthUser> {
  const payload = await authPost<{ user: AuthUser }>('/auth/account/restore', input);
  return payload.user;
}

export async function confirmLoginAlert(alertId: string): Promise<void> {
  await authPost(`/auth/login-alerts/${encodeURIComponent(alertId)}/confirm`, {});
}

export async function denyLoginAlert(alertId: string): Promise<{ sessionEnded: boolean; recoveryCodes: RecoveryCodesStatus }> {
  const payload = await authPost<{ sessionEnded?: boolean; recoveryCodes?: RecoveryCodesStatus }>(
    `/auth/login-alerts/${encodeURIComponent(alertId)}/deny`,
    {}
  );
  return { sessionEnded: payload.sessionEnded === true, recoveryCodes: readRecoveryCodesStatus(payload.recoveryCodes) };
}

export async function fetchAccountSessions(): Promise<AccountSession[]> {
  const payload = await authRead<{ sessions?: unknown[] }>('/auth/sessions', 'GET', 'Не удалось загрузить устройства');
  return (Array.isArray(payload.sessions) ? payload.sessions : [])
    .map(normalizeAccountSession)
    .filter((session): session is AccountSession => session !== null);
}

export async function revokeAccountSession(sessionId: string): Promise<void> {
  await authRead(`/auth/sessions/${encodeURIComponent(sessionId)}`, 'DELETE', 'Не удалось завершить сеанс');
}

export async function revokeOtherAccountSessions(): Promise<number> {
  const payload = await authPost<{ revoked?: number }>('/auth/sessions/revoke-others', {});
  return Math.max(0, Number(payload.revoked) || 0);
}

export async function generateRecoveryCodes(
  currentPassword: string
): Promise<{ codes: string[]; recoveryCodes: RecoveryCodesStatus }> {
  const payload = await authPost<{ codes?: unknown[]; recoveryCodes?: RecoveryCodesStatus }>(
    '/auth/recovery-codes',
    { currentPassword }
  );
  return {
    codes: (Array.isArray(payload.codes) ? payload.codes : []).filter((code): code is string => typeof code === 'string'),
    recoveryCodes: readRecoveryCodesStatus(payload.recoveryCodes)
  };
}

export async function recoverAccount(input: RecoverInput): Promise<{ user: AuthUser; remaining: number }> {
  const payload = await authPost<{ user: AuthUser; recoveryCodes?: Partial<RecoveryCodesStatus> }>('/auth/recover', input);
  return { user: payload.user, remaining: readRecoveryCodesStatus(payload.recoveryCodes).remaining };
}