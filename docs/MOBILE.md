# Mobile contracts

Mobile backend contracts for account deletion, Ring lifecycle, and user reports.

## Android account deletion: cookie response boundary

The Android client shares an OS-managed cookie jar across asynchronous HTTP
requests. A successful deletion response can arrive after a different account
has signed in. JavaScript cannot prevent a `Set-Cookie` clear already applied by
that jar, so `POST /api/auth/account/deletion` omits the clearing response cookie
when the existing shared parser recognizes a nonempty, valid Android app version.
Browser and malformed-native user agents retain the previous clearing behavior.

This is response delivery policy, not an authentication exception. Session
resolution, password verification, rate limiting, account deletion, all-session
revocation and token invalidation are unchanged. The Android jar may retain the
old revoked token until the next sign-in replaces it; it no longer authenticates.
A forged user agent does not make an unauthenticated deletion request succeed.

The mobile client must still ignore stale operation results and guard HTTP 401
session-ending side effects by authentication generation. Its release dependency
must include this server change: JavaScript-only guards do not prevent cookie-jar
mutation from an older backend response. No production deployment is implied.

Regression coverage lives in `apps/api/test/account-deletion-http.test.ts` and
`apps/api/test/account-domain.test.ts`: native success has no `Set-Cookie`, both
old account tokens are unusable, a replacement account stays authenticated,
browser/malformed-native success still clears, and user-agent spoofing cannot
bypass session or password checks.

## Ring lifecycle for Android v1

### Compatibility and meaning

The legacy `POST /api/rooms/:roomId/ring` still returns exactly `{ok:true}` and
emits the existing `ring.incoming` plus room-invitation DM events. Caller voice
presence is not required. A Ring is a short-lived invitation cue, not a voice
session. Accepting it acknowledges the invitation; room join, bans, microphone
permission and media admission remain separate checks. The recipient's accept
or decline also answers the persistent invitation DM through the DM
repository (`respondInvite`), and both accounts receive `dm.message.edited`.
Ring expiry/cancellation never changes the invitation DM's status: it stays
answerable.

New endpoints:
- `POST /api/rings`: `roomId`, `userId`, `clientRequestId` (UUID); returns `RingAnswer`.
- `GET /api/rings/:ringId`: caller/recipient status, `Cache-Control: no-store`.
- `POST /api/rings/:ringId/respond`: recipient `accept` or `decline`.
- `POST /api/rings/:ringId/cancel`: caller cancellation.

Unrelated actors and wrong action roles get 404 even for a terminal record.
Actions are idempotent but HTTP 200 does not imply the requested action won:
inspect the returned state. Only pending can become terminal. The user-pair lock
and row lock serialize competing actions, and expiry uses database wall time
**after** waiting and awaited authorization checks. The terminal UPDATE uses a
single database timestamp for both expiry precedence and `endedAt`; expiry wins
if the deadline has elapsed, including during a ban lookup. Status/accept revalidate account availability, friendship,
blocks, room existence and recipient account/IP bans. A caller's address is not
mistaken for the recipient address. Actual admission rechecks authorization.

Creation uses the existing DM repository transaction hooks. Its new narrow
`prepareMessage` hook resolves invitation text/metadata after authorization on
that same connection; the Ring repository never writes foreign DM tables.
Matching caller/request UUID replay returns one Ring/DM without another rate
charge or event; a different target/room with the same key conflicts. Creation
locks caller/request identity before the user pair, so concurrent different-target
requests also return a conflict rather than a uniqueness error. Legacy
requests generate a new request UUID and retain their existing retry behavior.
The configured per-pair rate window/count are enforced in PostgreSQL across API
replicas, not an independent per-process limit. Idempotency lasts 24 hours.

### Native delivery

`room_rings` and `ring_delivery_outbox` are additive storage. Each API process
runs a bounded embedded delivery runtime; database job claims fence replicas.
Creation and terminal transitions persist their delivery jobs transactionally.
Incoming jobs revalidate pending/expiry immediately before sending. A terminal
job is native-only: it never goes through unfiltered web/native fanout and never
reuses `ring.incoming`. Stop data bypasses DND/mutes; initial cues honor DND,
chat mutes and private-text preferences. The original Web Push cue is sent once,
best-effort, with `skipNative:true`; Android delivery uses the durable outbox.

Incoming `type:'ring'`, `v:'1'` adds optional `ringId`, `recipientUserId` and
`ringRevision`. Terminal `type:'ring.state'` adds `ringState`, with a destination
account binding and deterministic ring/revision/account dedupe. It has **no
RuStore notification or notification channel**, only data. The open-string type
and optional keys do not widen an existing server-sent realtime union. The
frozen fa84ce81 parser fixture confirms terminal data is not an old Ring cue.

Native clients must record terminal tombstones so a delayed initial push cannot
re-ring; status revalidation is authoritative before media capture. Terminal
transport retries have their own five-minute deadline, independent of the old
Ring expiry. Strict partial-device failure retries retain failed siblings; a
successful phone may receive a deduplicated repeat. Expired tokens are pruned by
the existing sender; transferred-token devices must reject another account's
binding. Transport acceptance is not proof of display, receipt or media join.

Every poll expires bounded batches and enqueues stop jobs. Hard 24-hour retention
removes state/idempotency and jobs even after provider failure; DMs are preserved.
Claims expire after 30 seconds; acknowledgements/retries require the current
claim token. API shutdown stops polling and waits for its current delivery.
In-flight network deliveries can still reorder; revision/tombstone handling and
server revalidation are required, not inferred from fencing alone.

### Deployment and rollback

No deployment is authorized by this source slice. Apply migration
`20261026150100_create_room_rings` before this API, and deploy the reviewed
shared/API ref before enabling the corresponding mobile lifecycle feature.
RuStore configuration and real certificate/device acceptance remain release gates.
No extra worker container is required; each API replica owns the embedded poller.
Operator privacy/retention policy validation is still required.

An application rollback can leave these additive tables in place. Do not run a
production down migration merely to roll back code: it discards Ring state/jobs.
The controlled test down/up path drops only Ring tables and preserves DMs. No
real account, production migration, token, service key or store action was used
for local verification.

## User reporting: mobile v1 backend slice

### Compatibility decision

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

### Storage and retention

Migration `20261026150000_create_user_reports.ts` adds a separate `user_reports`
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

### Deployment and rollback boundaries

Deploy only under separately authorized release procedure. Apply the additive
migration before running this API version. Older APIs continue to use only
`content_reports`; an application rollback can leave `user_reports` intact.
Do not run a down migration on production merely to roll back the application.

The local/test down migration drops only `user_reports` (and therefore its cases),
preserving all legacy message reports. Forward/down/reapply behavior and generated
Kysely type equality are covered by database tests. No production migration or
store submission is performed by this implementation slice.
