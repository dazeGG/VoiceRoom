// Reports to the service operator. Staff review them in the admin app.

import { ReportFiled, type ReportBody } from '@voice-room/shared/contracts/reports';
import { api } from './client';

export type { ReportReason, ReportTarget } from '@voice-room/shared/contracts/reports';

export async function fileReport(body: ReportBody): Promise<ReportFiled['status']> {
  return (await api.post('/api/reports', ReportFiled, body, { fallback: 'Не удалось отправить жалобу' })).status;
}
