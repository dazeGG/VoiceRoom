// The platform administrator's panel: whether this account may open it, the
// product and server numbers it shows, the accounts and the rooms.

import {
  AccountDetail,
  AccountsPage,
  AdminAccess,
  AdminOverview,
  LiveRooms,
  RoomHistory,
  ProductStats,
  SystemStats,
  type AccountsQuery,
  type ProductQuery,
  type RoomHistoryQuery,
  type SystemQuery,
  type BadgeBody,
  type BlockBody,
  type DeleteAccountBody
} from '@voice-room/shared/contracts/admin';
import type { AccountBadge } from '@voice-room/shared/contracts/users';
import { api } from './client';

export type {
  AccountDetail,
  AccountDay,
  AccountRow,
  AccountsFilter,
  AccountsPage,
  AccountsSort,
  AdminActionEntry,
  BlockDuration,
  AdminOverview,
  AdminReportsEvent,
  LiveRoom,
  LiveRoomPeer,
  LiveRooms,
  RoomAccount,
  RoomHistory,
  RoomStay,
  ProductDay,
  ProductStats,
  RetentionWeek,
  SystemSample,
  SystemStats
} from '@voice-room/shared/contracts/admin';

export async function fetchAdminAccess(): Promise<{ admin: boolean; openReports: number }> {
  const { admin, openReports } = await api.get('/api/admin/access', AdminAccess, {
    fallback: 'Не удалось проверить доступ'
  });
  return { admin, openReports };
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  return api.get('/api/admin/overview', AdminOverview, { fallback: 'Не удалось загрузить обзор' });
}

function search(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export async function fetchProductStats(query: ProductQuery = {}): Promise<ProductStats> {
  return api.get(`/api/admin/product${search(query)}`, ProductStats, { fallback: 'Не удалось загрузить статистику' });
}

export async function fetchSystemStats(query: SystemQuery = {}): Promise<SystemStats> {
  return api.get(`/api/admin/system${search(query)}`, SystemStats, {
    fallback: 'Не удалось загрузить данные сервера'
  });
}

export async function fetchLiveRooms(): Promise<LiveRooms> {
  return api.get('/api/admin/rooms', LiveRooms, { fallback: 'Не удалось загрузить комнаты' });
}

export async function fetchRoomHistory(query: RoomHistoryQuery = {}): Promise<RoomHistory> {
  return api.get(`/api/admin/rooms/history${search(query)}`, RoomHistory, {
    fallback: 'Не удалось загрузить историю'
  });
}

export async function fetchAccounts(query: AccountsQuery = {}): Promise<AccountsPage> {
  return api.get(`/api/admin/accounts${search(query)}`, AccountsPage, { fallback: 'Не удалось загрузить аккаунты' });
}

const accountPath = (userId: string) => `/api/admin/accounts/${encodeURIComponent(userId)}`;

export async function fetchAccount(userId: string): Promise<AccountDetail> {
  return api.get(accountPath(userId), AccountDetail, { fallback: 'Не удалось загрузить аккаунт' });
}

export async function blockAccount(userId: string, body: BlockBody): Promise<AccountDetail> {
  return api.post(`${accountPath(userId)}/block`, AccountDetail, body, { fallback: 'Не удалось заблокировать' });
}

export async function unblockAccount(userId: string): Promise<AccountDetail> {
  return api.post(`${accountPath(userId)}/unblock`, AccountDetail, {}, { fallback: 'Не удалось разблокировать' });
}

export async function signOutAccount(userId: string): Promise<AccountDetail> {
  return api.post(`${accountPath(userId)}/sign-out`, AccountDetail, {}, { fallback: 'Не удалось завершить сеансы' });
}

export async function deleteAccount(userId: string, body: DeleteAccountBody): Promise<AccountDetail> {
  return api.post(`${accountPath(userId)}/delete`, AccountDetail, body, { fallback: 'Не удалось удалить аккаунт' });
}

export async function cancelAccountDeletion(userId: string): Promise<AccountDetail> {
  return api.post(
    `${accountPath(userId)}/cancel-deletion`,
    AccountDetail,
    {},
    {
      fallback: 'Не удалось отменить удаление'
    }
  );
}

export async function setAccountBadge(userId: string, badge: AccountBadge | null): Promise<AccountDetail> {
  const body: BadgeBody = { badge };
  return api.post(`${accountPath(userId)}/badge`, AccountDetail, body, { fallback: 'Не удалось изменить отметку' });
}
