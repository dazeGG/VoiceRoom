import type { AdminReportsEvent } from '@voice-room/shared/contracts/admin';
import type { ReportReason } from '@voice-room/shared/contracts/reports';

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
