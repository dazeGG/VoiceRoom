// The platform administrator's panel: whether this account may open it, and
// the product and server numbers it shows.

import type {
  AdminAccess,
  AdminOverview,
  ProductQuery,
  ProductStats,
  SystemQuery,
  SystemStats
} from '@voice-room/shared/contracts/admin';
import { api } from './client';

export type {
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
