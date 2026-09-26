// The account records the user repositories share: row mapping, the public
// and self profile shapes, session and recovery-code hashing, and limits.

import crypto from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { AccountLoginEvents, Json, Users } from '../../platform/db/schema.ts';
import type { SelfUser as SelfProfile } from '@voice-room/shared/contracts/account';
import type { PublicUser as PublicProfile } from '@voice-room/shared/contracts/users';
import { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus } from '@voice-room/shared/validation';
import { RECOVERY_CODE_ALPHABET, RECOVERY_CODE_LENGTH } from '@voice-room/shared/account-security';

export type UserStoreLogger = { warn(...args: unknown[]): void };
export type StoredUser = NonNullable<ReturnType<typeof mapUser>>;
export type PublicUser = PublicProfile;

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
export const USER_AGENT_MAX_LENGTH = 512;
export const LOCATION_LABEL_MAX_LENGTH = 120;
export const UNIQUE_VIOLATION = '23505';
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Longer than the familiarity window, so a device keeps vouching for itself
// for the whole window after its last sign-in.
export const LOGIN_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function toDate(ms: unknown): Date {
  const next = Number(ms);
  return new Date(Number.isFinite(next) && next >= 0 ? next : Date.now());
}

export function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

// Per-account markers kept in `users.metadata` as epoch milliseconds.
export function metadataMillis(metadata: unknown, key: string): number | null {
  const value = Number(metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>)[key] : NaN);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function randomAvatarColorKey(): string {
  return AVATAR_COLOR_KEYS[crypto.randomInt(AVATAR_COLOR_KEYS.length)] as string;
}

export function mapUser(row: Selectable<Users> | null | undefined) {
  if (!row) return null;
  const presenceStatus = cleanPresenceStatus(row.presence_status) || (row.dnd ? 'dnd' : 'online');
  return {
    avatarAccent: row.avatar_accent || null,
    avatarColorKey: cleanAvatarColorKey(row.avatar_color_key) || 'blurple',
    avatarKey: row.avatar_key || null,
    createdAt: toMillis(row.created_at),
    displayName: row.display_name || '',
    doNotDisturb: presenceStatus === 'dnd',
    id: row.id,
    login: row.login,
    passwordHash: row.password_hash,
    presenceStatus,
    deletionRequestedAt: row.deletion_requested_at ? toMillis(row.deletion_requested_at) : null,
    deletedAt: row.deleted_at ? toMillis(row.deleted_at) : null,
    desktopAppSeenAt: metadataMillis(row.metadata, 'desktopAppSeenAt'),
    appPromptSeenAt: metadataMillis(row.metadata, 'appPromptSeenAt')
  };
}

/** Enough of an account to show it: the id and login, and whatever else is known. */
export type ProfileSource = Pick<StoredUser, 'id' | 'login'> & Partial<StoredUser>;

// What we ever send back to a client: never the password hash.
export function publicUser(user: ProfileSource): PublicProfile;
export function publicUser(user: ProfileSource | null | undefined): PublicProfile | null;
export function publicUser(user: ProfileSource | null | undefined): PublicProfile | null {
  if (!user) return null;
  const presenceStatus = cleanPresenceStatus(user.presenceStatus) || (user.doNotDisturb ? 'dnd' : 'online');
  return {
    avatarAccent: user.avatarAccent || null,
    createdAt: user.createdAt ?? null,
    avatarColorKey: user.avatarColorKey || 'blurple',
    avatarUrl: user.avatarKey ? `/api/avatars/${encodeURIComponent(user.avatarKey)}` : null,
    displayName: user.displayName || '',
    dnd: presenceStatus === 'dnd',
    doNotDisturb: presenceStatus === 'dnd',
    id: user.id,
    login: user.login,
    presenceStatus
  };
}

// The signed-in account's own view: the public shape plus facts that must never
// reach other users (DM peers, profile broadcasts, message authors).
export function selfUser(user: ProfileSource): SelfProfile;
export function selfUser(user: ProfileSource | null | undefined): SelfProfile | null;
export function selfUser(user: ProfileSource | null | undefined): SelfProfile | null {
  const base = publicUser(user);
  if (!base || !user) return null;
  return {
    ...base,
    hasUsedDesktopApp: Boolean(user.desktopAppSeenAt),
    appPromptSeen: Boolean(user.appPromptSeenAt)
  };
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: unknown): string {
  return crypto.createHash('sha256').update(String(token)).digest('base64url');
}

export function createRecoveryCode(): string {
  let code = '';
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += RECOVERY_CODE_ALPHABET[crypto.randomInt(RECOVERY_CODE_ALPHABET.length)];
  }
  return code;
}

// Bound to the account so the same code on two accounts never shares a hash.
export function hashRecoveryCode(userId: string, code: string): string {
  return crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

export function cleanUserAgent(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, USER_AGENT_MAX_LENGTH) : '';
}

export function cleanLocationLabel(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, LOCATION_LABEL_MAX_LENGTH) : '';
}

// What a device is shown by; the session it opened stays server-side. Only
// sign-ins and recoveries raise alerts; a registration never does.
export function mapLoginAlert(row: Selectable<AccountLoginEvents>) {
  return {
    id: row.id,
    kind: row.kind === 'recovery' ? ('recovery' as const) : ('login' as const),
    client: row.client || '',
    os: row.os || '',
    location: row.location_label || '',
    createdAt: toMillis(row.created_at)
  };
}

// Stamps when an account first used the desktop app.
export const desktopAppSeen = (now: number) =>
  sql<Json>`jsonb_set(metadata, '{desktopAppSeenAt}', to_jsonb(${Math.trunc(Number(now) || Date.now())}::bigint), true)`;
export const hasMetadataKey = (key: string) => sql<boolean>`metadata ? ${key}`;
