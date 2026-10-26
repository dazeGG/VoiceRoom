# Ring lifecycle for Android v1

## Compatibility and meaning

The legacy `POST /api/rooms/:roomId/ring` still returns exactly `{ok:true}` and
emits the existing `ring.incoming` plus room-invitation DM events. Caller voice
presence is not required. A Ring is a short-lived invitation cue, not a voice
session. Accepting it acknowledges the invitation; room join, bans, microphone
permission and media admission remain separate checks. Ring expiry/cancellation
never changes the persistent invitation DM's status.

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

## Native delivery

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

## Deployment and rollback

No deployment is authorized by this source slice. Apply migration
`20261025130000_create_room_rings` before this API, and deploy the reviewed
shared/API ref before enabling the corresponding mobile lifecycle feature.
RuStore configuration and real certificate/device acceptance remain release gates.
No extra worker container is required; each API replica owns the embedded poller.
Operator privacy/retention policy validation is still required.

An application rollback can leave these additive tables in place. Do not run a
production down migration merely to roll back code: it discards Ring state/jobs.
The controlled test down/up path drops only Ring tables and preserves DMs. No
real account, production migration, token, service key or store action was used
for local verification.
