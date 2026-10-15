// The platform administrator's panel: whether this account may open it, and
// the product and server numbers it shows.

import type {
  AdminAccess,
  AdminOverview,
  ProductRange,
  ProductStats,
  SystemRange,
  SystemStats
} from '@voice-room/shared/contracts/admin';
import { api } from './client';

export type {
  AdminOverview,
  ProductDay,
  ProductRange,
  ProductStats,
  RetentionWeek,
  SystemRange,
  SystemSample,
  SystemStats
} from '@voice-room/shared/contracts/admin';

export async function fetchAdminAccess(): Promise<boolean> {
  return (await api.get<AdminAccess>('/api/admin/access', { fallback: 'Не удалось проверить доступ' })).admin;
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  return api.get<AdminOverview>('/api/admin/overview', { fallback: 'Не удалось загрузить обзор' });
}

export async function fetchProductStats(range: ProductRange): Promise<ProductStats> {
  return api.get<ProductStats>(`/api/admin/product?range=${range}`, { fallback: 'Не удалось загрузить статистику' });
}

export async function fetchSystemStats(range: SystemRange): Promise<SystemStats> {
  return api.get<SystemStats>(`/api/admin/system?range=${range}`, { fallback: 'Не удалось загрузить данные сервера' });
}
