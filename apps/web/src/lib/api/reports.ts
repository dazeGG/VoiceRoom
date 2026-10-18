// Reports to the service operator, and the platform administrator's review.

import {
  AdminReportPage,
  ReportFiled,
  ReportResolved,
  type AdminReport,
  type ReportBody,
  type ReportResolveBody
} from '@voice-room/shared/contracts/reports';
import { api } from './client';

export type { AdminReport, ReportReason, ReportTarget } from '@voice-room/shared/contracts/reports';

export async function fileReport(body: ReportBody): Promise<ReportFiled['status']> {
  return (await api.post('/api/reports', ReportFiled, body, { fallback: 'Не удалось отправить жалобу' })).status;
}

export async function fetchOpenReports(): Promise<AdminReport[]> {
  return (await api.get('/api/admin/reports', AdminReportPage, { fallback: 'Не удалось загрузить жалобы' })).reports;
}

export async function resolveReport(reportId: string, action: ReportResolveBody['action']): Promise<number> {
  const body: ReportResolveBody = { action };
  return (
    await api.post(`/api/admin/reports/${encodeURIComponent(reportId)}/resolve`, ReportResolved, body, {
      fallback: 'Не удалось закрыть жалобу'
    })
  ).resolved;
}
