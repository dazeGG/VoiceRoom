// Whether this account is staff, and where the admin app lives. The admin app
// itself is a separate site (apps/admin); the main site only links to it.

import type { StaffAccess } from '@voice-room/shared/contracts/staff';
import { api } from './client';

export async function fetchStaffAccess(): Promise<Omit<StaffAccess, 'ok'>> {
  const { staff, adminUrl, openReports } = await api.get<StaffAccess>('/api/staff/access', {
    fallback: 'Не удалось проверить доступ'
  });
  return { staff, adminUrl, openReports };
}
