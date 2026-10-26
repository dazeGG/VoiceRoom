// Signed-in accounts can report visible messages or another existing account.
// Staff review messages and users through separate response contracts, so
// older message-review clients never receive a new server-sent target kind.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

export const REPORT_REASONS = ['spam', 'abuse', 'illegal', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_COMMENT_MAX_LENGTH = 500;

export const ReportReasonSchema = Type.Enum(REPORT_REASONS);

export const ReportTarget = Type.Union([
  Type.Object({ kind: Type.Literal('room_message'), roomId: Type.String(), messageId: Type.String() }),
  Type.Object({ kind: Type.Literal('direct_message'), messageId: Type.String() }),
  Type.Object({ kind: Type.Literal('user'), userId: Type.String({ minLength: 1, maxLength: 36 }) })
]);
export type ReportTarget = Static<typeof ReportTarget>;

export const ReportBody = Type.Object({
  target: ReportTarget,
  reason: ReportReasonSchema,
  comment: Type.Optional(Type.String({ maxLength: REPORT_COMMENT_MAX_LENGTH }))
});
export type ReportBody = Static<typeof ReportBody>;

/** A second open report of the same target by the same account is not stored twice. */
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

/** User review has its own response: older message-review clients keep their union unchanged. */
export const AdminUserReport = Type.Object({
  id: Type.String(),
  reason: ReportReasonSchema,
  comment: Type.String(),
  createdAt: Type.Number(),
  reporter: Type.Object({ userId: Type.String(), login: Type.String(), displayName: Type.String() }),
  target: Type.Object({
    userId: Type.String(),
    login: Type.String(),
    displayName: Type.String(),
    deleted: Type.Boolean()
  })
});
export type AdminUserReport = Static<typeof AdminUserReport>;
export const AdminUserReportPage = Ok({ reports: Type.Array(AdminUserReport) });
export type AdminUserReportPage = Static<typeof AdminUserReportPage>;

/** Reviewing a user never deletes a user or message; account sanctions use the existing staff tools. */
export const UserReportResolveBody = Type.Object({
  action: Type.Union([Type.Literal('reviewed'), Type.Literal('dismiss')])
});
export type UserReportResolveBody = Static<typeof UserReportResolveBody>;
