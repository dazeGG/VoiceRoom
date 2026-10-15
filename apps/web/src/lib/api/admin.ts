// The platform administrator's panel: whether this account may open it, and
// the product and server numbers it shows.

import type {
  AccountDetail,
  AccountsPage,
  AccountsQuery,
  AdminAccess,
  AdminOverview,
  ProductQuery,
  ProductStats,
  SystemQuery,
  SystemStats,
  BadgeBody,
  BlockBody,
  DeleteAccountBody
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
  ProductDay,
  ProductStats,
  RetentionWeek,
  SystemSample,
  SystemStats
} from '@voice-room/shared/contracts/admin';

export async function fetchAdminAccess(): Promise<{ admin: boolean; openReports: number }> {
  const { admin, openReports } = await api.get<AdminAccess>('/api/admin/access', {
    fallback: 'Не удалось проверить доступ'
  });
  return { admin, openReports };
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  return api.get<AdminOverview>('/api/admin/overview', { fallback: 'Не удалось загрузить обзор' });
}

function search(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export async function fetchProductStats(query: ProductQuery = {}): Promise<ProductStats> {
  return api.get<ProductStats>(`/api/admin/product${search(query)}`, { fallback: 'Не удалось загрузить статистику' });
}

export async function fetchSystemStats(query: SystemQuery = {}): Promise<SystemStats> {
  return api.get<SystemStats>(`/api/admin/system${search(query)}`, {
    fallback: 'Не удалось загрузить данные сервера'
  });
}

export async function fetchAccounts(query: AccountsQuery = {}): Promise<AccountsPage> {
  return api.get<AccountsPage>(`/api/admin/accounts${search(query)}`, { fallback: 'Не удалось загрузить аккаунты' });
}

const accountPath = (userId: string) => `/api/admin/accounts/${encodeURIComponent(userId)}`;

export async function fetchAccount(userId: string): Promise<AccountDetail> {
  return api.get<AccountDetail>(accountPath(userId), { fallback: 'Не удалось загрузить аккаунт' });
}

export async function blockAccount(userId: string, body: BlockBody): Promise<AccountDetail> {
  return api.post<AccountDetail>(`${accountPath(userId)}/block`, body, { fallback: 'Не удалось заблокировать' });
}

export async function unblockAccount(userId: string): Promise<AccountDetail> {
  return api.post<AccountDetail>(`${accountPath(userId)}/unblock`, {}, { fallback: 'Не удалось разблокировать' });
}

export async function signOutAccount(userId: string): Promise<AccountDetail> {
  return api.post<AccountDetail>(`${accountPath(userId)}/sign-out`, {}, { fallback: 'Не удалось завершить сеансы' });
}

export async function deleteAccount(userId: string, body: DeleteAccountBody): Promise<AccountDetail> {
  return api.post<AccountDetail>(`${accountPath(userId)}/delete`, body, { fallback: 'Не удалось удалить аккаунт' });
}

export async function cancelAccountDeletion(userId: string): Promise<AccountDetail> {
  return api.post<AccountDetail>(
    `${accountPath(userId)}/cancel-deletion`,
    {},
    {
      fallback: 'Не удалось отменить удаление'
    }
  );
}

export async function setAccountBadge(userId: string, badge: AccountBadge | null): Promise<AccountDetail> {
  const body: BadgeBody = { badge };
  return api.post<AccountDetail>(`${accountPath(userId)}/badge`, body, { fallback: 'Не удалось изменить отметку' });
}
