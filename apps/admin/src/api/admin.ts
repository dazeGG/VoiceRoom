// The admin endpoints the app calls, each with the schema its answer is checked
// against (see client.ts).

import {
  AccountDetail,
  AccountsPage,
  AdminOverview,
  LiveRooms,
  ProductStats,
  RoomCalls,
  SystemStats,
  type AccountsQuery,
  type BlockBody,
  type DeleteAccountBody,
  type ProductQuery,
  type RoomCallsQuery,
  type SystemQuery
} from '@voice-room/shared/contracts/admin';
import { AdminCallFeedbackPage, type AdminCallFeedbackQuery } from '@voice-room/shared/contracts/feedback';
import {
  AdminReportPage,
  AdminUserReportPage,
  ReportResolved,
  type ReportResolveBody,
  type UserReportResolveBody
} from '@voice-room/shared/contracts/reports';
import type { AccountBadge } from '@voice-room/shared/contracts/users';
import { api, search } from './client.ts';

export const fetchOverview = () => api.get('/api/admin/overview', AdminOverview, 'Не удалось загрузить обзор');

export const fetchProductStats = (query: ProductQuery = {}) =>
  api.get(`/api/admin/product${search(query)}`, ProductStats, 'Не удалось загрузить статистику');

export const fetchSystemStats = (query: SystemQuery = {}) =>
  api.get(`/api/admin/system${search(query)}`, SystemStats, 'Не удалось загрузить данные сервера');

export const fetchLiveRooms = () => api.get('/api/admin/rooms', LiveRooms, 'Не удалось загрузить комнаты');

export const fetchRoomCalls = (query: RoomCallsQuery = {}) =>
  api.get(`/api/admin/rooms/calls${search(query)}`, RoomCalls, 'Не удалось загрузить историю');

export const fetchAccounts = (query: AccountsQuery = {}) =>
  api.get(`/api/admin/accounts${search(query)}`, AccountsPage, 'Не удалось загрузить аккаунты');

const accountPath = (userId: string) => `/api/admin/accounts/${encodeURIComponent(userId)}`;

export const fetchAccount = (userId: string) =>
  api.get(accountPath(userId), AccountDetail, 'Не удалось загрузить аккаунт');

export const blockAccount = (userId: string, body: BlockBody) =>
  api.post(`${accountPath(userId)}/block`, AccountDetail, body, 'Не удалось заблокировать');

export const unblockAccount = (userId: string) =>
  api.post(`${accountPath(userId)}/unblock`, AccountDetail, {}, 'Не удалось разблокировать');

export const signOutAccount = (userId: string) =>
  api.post(`${accountPath(userId)}/sign-out`, AccountDetail, {}, 'Не удалось завершить сеансы');

export const deleteAccount = (userId: string, body: DeleteAccountBody) =>
  api.post(`${accountPath(userId)}/delete`, AccountDetail, body, 'Не удалось удалить аккаунт');

export const cancelAccountDeletion = (userId: string) =>
  api.post(`${accountPath(userId)}/cancel-deletion`, AccountDetail, {}, 'Не удалось отменить удаление');

export const setAccountBadge = (userId: string, badge: AccountBadge | null) =>
  api.post(`${accountPath(userId)}/badge`, AccountDetail, { badge }, 'Не удалось изменить отметку');

export const fetchOpenReports = async () =>
  (await api.get('/api/admin/reports', AdminReportPage, 'Не удалось загрузить жалобы')).reports;

export const fetchOpenUserReports = async () =>
  (await api.get('/api/admin/user-reports', AdminUserReportPage, 'Не удалось загрузить жалобы на пользователей'))
    .reports;

export const resolveUserReport = async (reportId: string, action: UserReportResolveBody['action']) =>
  (
    await api.post(
      `/api/admin/user-reports/${encodeURIComponent(reportId)}/resolve`,
      ReportResolved,
      { action },
      'Не удалось закрыть жалобу'
    )
  ).resolved;

export const resolveReport = async (reportId: string, action: ReportResolveBody['action']) =>
  (
    await api.post(
      `/api/admin/reports/${encodeURIComponent(reportId)}/resolve`,
      ReportResolved,
      { action },
      'Не удалось закрыть жалобу'
    )
  ).resolved;

export const fetchCallFeedback = (query: AdminCallFeedbackQuery = {}) =>
  api.get(`/api/admin/feedback${search(query)}`, AdminCallFeedbackPage, 'Не удалось загрузить отзывы');
