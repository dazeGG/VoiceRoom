// How a report's reason and place read, for the main site's notice of a new
// report and for the admin app's list.

import type { AdminReportsEvent } from './contracts/admin.ts';
import type { ReportReason } from './contracts/reports.ts';

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Спам или реклама',
  abuse: 'Оскорбления или угрозы',
  illegal: 'Запрещённый контент',
  other: 'Другое'
};

/** What a new report's notice says: why, and where the message is. */
export function describeFiledReport(filed: NonNullable<AdminReportsEvent['filed']>): string {
  const where = filed.roomName
    ? `комната «${filed.roomName}»`
    : filed.targetKind === 'direct_message'
      ? 'личное сообщение'
      : 'временная комната';
  return `${REPORT_REASON_LABELS[filed.reason]} · ${where}`;
}
