// Who is signed in to the admin app, the staff list and their roles.

import { Type } from 'typebox';
import { StaffList, StaffMe, type StaffRole } from '@voice-room/shared/contracts/staff';
import { api } from './client.ts';

export const fetchMe = () => api.get('/api/staff/me', StaffMe, 'Не удалось загрузить профиль');

export const fetchStaff = async () =>
  (await api.get('/api/staff/members', StaffList, 'Не удалось загрузить сотрудников')).staff;

export const setStaffRole = (login: string, role: StaffRole | null) =>
  api.put('/api/staff/role', Type.Object({ ok: Type.Literal(true) }), { login, role }, 'Не удалось изменить роль');

export const signOut = () =>
  api.post('/api/staff/logout', Type.Object({ ok: Type.Literal(true) }), {}, 'Не удалось выйти');
