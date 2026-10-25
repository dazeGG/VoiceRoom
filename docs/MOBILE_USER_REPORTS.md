# User reporting: mobile v1 backend slice

## Compatibility decision

`POST /api/reports` additionally accepts `{ target: { kind: 'user', userId }, reason, comment? }`.
Its success shape remains `ReportFiled`. Message-report authorization, deduplication,
rate limiting and resolution are unchanged. User and message filing share the same
per-account limiter. Self-reporting returns 400 `invalid_request`; a missing or
deleted target returns 404 `report_target_not_found`.

New server-sent union values must ship one release before emission. Therefore this
slice does **not** widen `AdminReportPage` or `AdminReportsEvent.filed.targetKind`.
User reports have separate `AdminUserReportPage` and `UserReportResolveBody` schemas:

- `GET /api/admin/user-reports` lists the oldest 200 open reports.
- `POST /api/admin/user-reports/:reportId/resolve` accepts `reviewed` or `dismiss`.
- Both require an authenticated staff session and `reports.review` permission.
- The existing `admin.reports` event sends `filed: null` for user-report changes;
  its count includes both report kinds. The current admin sidebar also polls both
  lists, and the reports page has a dedicated user-review section.

`reviewed` closes every open report of that user as `actioned`; `dismiss` closes
them as `dismissed`. Neither deletes messages/users nor applies a sanction.
Staff inspect the linked account and use the existing separately authorized
account moderation tools when appropriate, then record their review decision.
An account may be reported again after the previous reports have been closed.

## Storage and retention

Migration `20261025120000_create_user_reports.ts` adds a separate `user_reports`
table and partial unique index on reporter/target while open. No existing message
report table or data is altered. Database constraints reject self-targeting,
unknown reasons, oversized comments and invalid open/resolved state combinations.

Reporter references use `ON DELETE CASCADE`, matching existing content reports.
Target references deliberately have no cascading foreign key: a target's deletion
does not erase a pending moderation case. No profile snapshot is stored. Live
profile data is read at review time; deleted/anonymized targets have blank profile
fields and `deleted: true`. The normal account-deletion process anonymizes the
existing user row, so the reviewer sees only the anonymized reporter identity.
Operator legal/privacy retention decisions still require owner validation.

## Deployment and rollback boundaries

Deploy only under separately authorized release procedure. Apply the additive
migration before running this API version. Older APIs continue to use only
`content_reports`; an application rollback can leave `user_reports` intact.
Do not run a down migration on production merely to roll back the application.

The local/test down migration drops only `user_reports` (and therefore its cases),
preserving all legacy message reports. Forward/down/reapply behavior and generated
Kysely type equality are covered by database tests. No production migration or
store submission is performed by this implementation slice.
