// Reports to the service operator: anyone signed in can report a room or
// direct message they can see, and a platform administrator (an account named
// in PLATFORM_ADMIN_USER_IDS) reviews the open reports and either removes the
// message for everyone or dismisses the reports.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

export const REPORT_REASONS = ['spam', 'abuse', 'illegal', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_COMMENT_MAX_LENGTH = 500;

export const ReportReasonSchema = Type.Enum(REPORT_REASONS);

export const ReportTarget = Type.Union([
  Type.Object({ kind: Type.Literal('room_message'), roomId: Type.String(), messageId: Type.String() }),
  Type.Object({ kind: Type.Literal('direct_message'), messageId: Type.String() })
]);
export type ReportTarget = Static<typeof ReportTarget>;

export const ReportBody = Type.Object({
  target: ReportTarget,
  reason: ReportReasonSchema,
  comment: Type.Optional(Type.String({ maxLength: REPORT_COMMENT_MAX_LENGTH }))
});
export type ReportBody = Static<typeof ReportBody>;

/** A second report of the same message by the same account is not stored twice. */
export const ReportFiled = Ok({ status: Type.Union([Type.Literal('filed'), Type.Literal('already_filed')]) });
export type ReportFiled = Static<typeof ReportFiled>;

export const AdminReport = Type.Object({
  id: Type.String(),
  reason: ReportReasonSchema,
  comment: Type.String(),
  createdAt: Type.Number(),
  reporter: Type.Object({ userId: Type.String(), login: Type.String(), displayName: Type.String() }),
  target: Type.Object({
    kind: Type.Union([Type.Literal('room_message'), Type.Literal('direct_message')]),
    messageId: Type.String(),
    roomId: Nullable(Type.String()),
    roomName: Nullable(Type.String()),
    authorUserId: Nullable(Type.String()),
    authorName: Type.String(),
    text: Type.String(),
    sentAt: Nullable(Type.Number()),
    /** The message is already gone (deleted by its author, a room owner or an earlier report). */
    deleted: Type.Boolean()
  })
});
export type AdminReport = Static<typeof AdminReport>;

export const AdminReportPage = Ok({ reports: Type.Array(AdminReport) });
export type AdminReportPage = Static<typeof AdminReportPage>;

export const ReportIdParams = Type.Object({ reportId: Type.String() });

export const ReportResolveBody = Type.Object({
  action: Type.Union([Type.Literal('remove_message'), Type.Literal('dismiss')])
});
export type ReportResolveBody = Static<typeof ReportResolveBody>;

/** Every open report of the same message is closed with the one decision. */
export const ReportResolved = Ok({ resolved: Type.Number() });
export type ReportResolved = Static<typeof ReportResolved>;
