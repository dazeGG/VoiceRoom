// Global user blocks. Blocking ends the friendship, cancels pending friend
// requests in both directions, and — because DM and room invites both require
// an active friendship — stops those too. It does not prevent sharing a room.

import { del, getJsonAuth, putJson } from './http';
import type { PublicUser } from './friends';

export type BlockStatus = 'blocked' | 'already_blocked';

function blockUrl(userId: string): string {
  return `/api/blocks/${encodeURIComponent(userId)}`;
}

export async function fetchBlockedUserIds(): Promise<string[]> {
  const payload = await getJsonAuth<{ ok: true; blocked?: unknown }>('/api/blocks');
  return Array.isArray(payload.blocked)
    ? payload.blocked.filter((id): id is string => typeof id === 'string')
    : [];
}

function blockedPublicUser(value: unknown): PublicUser | null {
  if (!value || typeof value !== 'object') return null;
  const user = value as Record<string, unknown>;
  if (typeof user.id !== 'string' || typeof user.login !== 'string') return null;
  return {
    avatarAccent: typeof user.avatarAccent === 'string' ? user.avatarAccent : null,
    avatarColorKey: typeof user.avatarColorKey === 'string' ? user.avatarColorKey : '',
    avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
    createdAt: typeof user.createdAt === 'number' ? user.createdAt : 0,
    displayName: typeof user.displayName === 'string' ? user.displayName : '',
    doNotDisturb: user.doNotDisturb === true,
    id: user.id,
    login: user.login,
    presenceStatus: user.presenceStatus === 'away' || user.presenceStatus === 'dnd' || user.presenceStatus === 'offline'
      ? user.presenceStatus
      : 'online'
  };
}

export async function fetchBlockedUsers(): Promise<PublicUser[]> {
  const payload = await getJsonAuth<{ ok: true; blocked?: unknown; users?: unknown }>('/api/blocks');
  const users = Array.isArray(payload.users)
    ? payload.users.map(blockedPublicUser).filter((user): user is PublicUser => user !== null)
    : [];
  if (users.length > 0) return users;
  const ids = Array.isArray(payload.blocked)
    ? payload.blocked.filter((id): id is string => typeof id === 'string')
    : [];
  return ids.map((id) => ({
    avatarAccent: null,
    avatarColorKey: id,
    avatarUrl: null,
    createdAt: 0,
    displayName: 'Заблокированный пользователь',
    doNotDisturb: false,
    id,
    login: '',
    presenceStatus: 'offline'
  }));
}

export async function blockUser(userId: string): Promise<BlockStatus> {
  const payload = await putJson<{ ok: true; status?: unknown }>(blockUrl(userId), {});
  return payload.status === 'already_blocked' ? 'already_blocked' : 'blocked';
}

export async function unblockUser(userId: string): Promise<void> {
  await del<{ ok: true }>(blockUrl(userId));
}
