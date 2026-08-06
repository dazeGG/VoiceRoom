# VoiceRoom 2.5.0 — unified messaging platform PRD

**Status:** Planner revision 7 repaired pair for Architect re-review; planning only.  
**Baseline:** `develop` `02d78bcf06e364aed0e72ed7216b4f12aa8809ad`; production tag `v2.4.2` on `6cd4b30ceea044fa9c0d0e279c82f4e5cd5668bd`.  
**Planning artifacts:** this file and `.omx/specs/test-spec-release-2-5-0-unified.md`.  
**Tracked execution sources after G01:** `docs/RELEASE_2.5.0_PLAN.md` and `docs/RELEASE_2.5.0_TEST_SPEC.md`. `.omx/` is ignored (`.gitignore:47`) and is never the sole execution source of truth.  
**Authority:** no source implementation, branch, push, PR, merge, deletion, tag, release, deploy, provider/topology purchase, or dependency addition is authorized by this planning revision.

> **Execution amendment (2026-07-20):** the 93 cards in §8 remain the detailed requirements and verification checklist, but they no longer require 93 branches or 93 PRs. Branch, predecessor-envelope, per-goal F7/F9/F11, and one-goal-at-a-time instructions are superseded by `docs/RELEASE_2.5.0_EXECUTION_PLAN.md`. The approved delivery shape is nine subsystem branches, with one review/evidence chain per branch and the existing four subsystem checkpoints retained.

## 1. Outcome, scope and stop condition

One backwards-compatible product minor, **VoiceRoom 2.5.0 — Messaging Platform**, absorbs the confirmed targets previously split across 2.5.0, 2.6.0 and 2.7.0. G01–G93 remain independently verifiable, flag-off slices derived from schema/contract/transaction/deployment boundaries, but delivery groups them into the nine subsystem branches defined by `docs/RELEASE_2.5.0_EXECUTION_PLAN.md`. Atomic Unit-of-Work changes are deliberately not split.

### 1.1 Included outcome

- reproducible CI, rendered-DOM/a11y and architecture gates; immutable OCI artifacts; publication/deployment separation; runtime config; public capabilities; operator flags; provenance; locked predeploy migrations; worker topology and observability;
- desktop-only root boundary, server/SW push suppression and physical/manual RC matrix;
- shared server-owned opaque cursor codec; room/DM latest/before/after/around; explicit 2.5 read cursors; replies; idempotent send; durable message delivery; active-ban correctness;
- persistent registered membership with active-only row semantics, offline roster, leave/delete/rejoin and strict LiveKit same-token invalidation;
- structured room content, active-member mentions, reply notifications, durable inbox and notification outbox, room policy/DND/privacy, unread navigation and server-authoritative room/DM RGI reactions including full reactor pagination;
- room/DM JPEG/PNG/WebP attachments, private storage, streaming validation, quota/pressure, separate workers, cleanup/reconcile, binding/access/UI, coordinated restore, temporary-ban moderation, idempotent unban and immediate media revocation after message deletion;
- N-1 clients, staged binary rollback, feature/operator rollback, pairwise/full activation, performance/security/backup/release evidence.

### 1.2 Retained exclusions

No private rooms; moderator/co-host roles; reports/audit log; DM mentions; `@everyone/@here`; global user/message search; pins/threads/slugs/invite-code management; reaction notifications/custom emoji; GIF/video/audio/document upload; S3/object store; antivirus/ML/transcoding; microservices/microfrontends; mobile product/PWA/offline; destructive schema down or removal of 2.x text/body fallback. Membership history is not required: if later desired it must use a separate table invisible to v2.4.2 and a new approved goal; `room_memberships` never stores left tombstones.

### 1.3 Release blockers

Release status becomes **BLOCKED**, without silently reducing scope, when:

1. the production-equivalent harness cannot prove strict same-issued-token denial after leave/ban/revoke, including restart/partition/clock/race cases;
2. the strict mechanism changes provider, recurring cost, topology, fork ownership or credential architecture and a scoped Planner→Architect→Critic amendment has not approved the resulting goals;
3. Unicode/RGI dependency authority, license, maintenance and version policy are unresolved before manifest mutation;
4. additive/N-1 behavioral compatibility, expiry-aware rescue rollback, migration lock-loss, media authorization, restore RPO≤1h/RTO≤4h, required budgets or exact-head evidence fails;
5. any staging checkpoint fails, any capability is advertised without prerequisites, replicas disagree on effective readiness, or a next-wave branch is created before repair;
6. a required code-review lane/verifier is unavailable, stale or non-approving;
7. final release SHA/digests mutate after approval or the authorized release merge cannot preserve the approved release head as a parent with an identical tree and verified provenance;
8. any ordinary PR, `develop` push, `main` push, release merge, tag, GitHub Release or backmerge actually reads/uses a production credential, schedules an environment/production job, contacts a production endpoint, migrates, deploys or builds on a deployment host under any authority. A possible/detected repository/org production secret, arbitrary dispatch ref or optional-promotion policy mismatch instead yields `PROMOTION_DISABLED_EXTERNAL_AUTHORITY`, schedules nothing, reads nothing and does not block publication after G12 removes every legacy reference;
9. the authenticated pre-G01 archive-authority gate cannot prove the exact GHCR owner/package/linkage/visibility/Actions-token contract, or explicit user/repository-owner authority to create/link it is absent: handoff becomes `WAITING_EXTERNAL_ARCHIVE_AUTHORITY` before any branch, Actions artifact or release lineage exists;
10. the G03 evidence package, ledger, digest pull, pinned ORAS verification, attestation, visibility/linkage or scheduled sentinel drifts/fails after lineage start; deletion/unavailability hard-stops that lineage and evidence bytes are never regenerated or relabeled.

### 1.4 Source-plan absorption matrix

| Existing target source | Unified 2.5.0 ownership | Closure gate |
| --- | --- | --- |
| 2.5 test/release foundation and architecture | G01–G15: tracked canon, autonomous CI, early durable evidence archive, strict-LKV/dependency gates, quality/ownership, later runtime image/SBOM publication, release/deploy boundary, runtime config, capability DAG and migration control | G15 plus every F11 predecessor |
| 2.5 desktop-only boundary | G16–G19: pure classifier, persisted normalized class, root/server/SW suppression and independently attested physical RC matrix | included in G42 and final RC |
| 2.5 cursor history, reads, replies, delivery and ban correctness | G20–G42: codec/contracts/seams/schema/API/Web/UoWs/workers/cutover/active-ban invariant | G42 messaging checkpoint |
| 2.5 membership/roster/strict credential boundary | G43–G50: active-only schema, admission, directory, offline roster, credential core/cutover and leave/delete/rejoin | G50 membership checkpoint |
| 2.6 structured content, mentions, inbox, notification policy/delivery and unread navigation | G51–G66, consuming G35/G37/G38 lease/outbox foundations | G71 engagement checkpoint |
| 2.6 Unicode reactions and full reactor list | G06–G07 dependency authority/conformance, then G67–G70 contract/persistence/API/Web | G71 engagement checkpoint |
| 2.7 attachments, storage, upload, processing, cleanup/reconcile/pressure, binding/read/compose/display | G72–G84 | G90 media checkpoint |
| 2.7 expiry-aware rollback, temporary bans, deletion, moderation and coordinated restore | G85–G89 | G90 media checkpoint |
| Cross-release performance, activation and release closure | G91 budgets, G92 exact-manifest matrix, G93 develop entry, then the separate exact-head RC procedure | production-side-effect-free tag/backmerge/deletion; any later promotion uses only G12 |

G01 replaces the tracked execution source with the approved unified plan/spec and adds explicit superseded pointers to the old 2.6/2.7 target documents. It may not delete historical rationale or label any unmet gate as implemented. Every confirmed source requirement is either mapped above, retained as a release-wide invariant/test, or named in §1.2 as an explicit exclusion.

## 2. Corrected compatibility truths

### 2.1 Membership: active-only legacy relation

`room_memberships` row existence continues to mean **active membership**, matching the source contract (`docs/RELEASE_2.5.0_PLAN.md:509-517`, `docs/RELEASE_2.5.0_PLAN.md:579-610`). Join uses idempotent insert; leave-room disconnects credentials/connections and then **deletes the row**; a failed delete leaves the user active and retryable. Ban does not delete membership. Leave-call preserves it. Owner cannot leave an owned static room. No `left`/tombstone state is added to the legacy relation. This avoids v2.4.2 queries interpreting history as active membership (`apps/api/src/lib/room-store.js:201-207`, `apps/api/src/lib/room-store.js:759-818`, `apps/api/src/lib/room-store.js:840-913`). Behavioral compatibility tests cover owner quota, visible rooms, summary/notification recipients, members directory, leave/rejoin and ban precedence—not startup only.

### 2.2 Temporary bans: staged binary rollback

Literal v2.4.2 is not a safe binary rollback target after any temporary ban is written because its current newest-row lookup does not enforce expiry (`apps/api/src/lib/room-store.js:525-541`). Before temporary-ban activation, G85 produces and proves an immutable **expiry-aware compatibility rescue digest** from the 2.5 code line: all new public capabilities false; write/worker/cleanup operator flags false; legacy 2.4.2 HTTP/realtime envelopes; active-only membership semantics; expiry-aware ban enforcement and safe reads. After first temporary-ban write, binary rollback targets this rescue digest, never literal v2.4.2. N-1 2.4.2 **client** compatibility remains required. Literal v2.4.2 binary rollback is allowed only before temporary-ban activation and only while the compatibility guard proves no temporary-ban rows were ever created.

### 2.3 LKV-0: strict-only acceptance

Strict invalidation of an already issued token is the only release truth. A bounded replay window is rejected for this scope; it requires a future explicit product/security scope amendment. G02 creates autonomous CI, G03 durably archives G01/G02 evidence, G04 creates the reproducible pinned LiveKit harness, and G05 proves/selects a strict mechanism.

If G05 evidence fits the already approved provider/topology/cost/fork/credential and goal shape, the normal exact-head review may close green G05 F11. If it implies any material change, the experiment freezes its failed evidence, emits **no green G05 F11**, closes/deletes the experiment branch and starts no successor. A docs-only `feature/2.5.0-g05-strict-lkv-amendment` from G04 green `develop` may write only literal `docs/releases/2.5.0/amendments/G05-STRICT-LKV.json`, `docs/RELEASE_2.5.0_PLAN.md` and `docs/RELEASE_2.5.0_TEST_SPEC.md`. The immutable artifact and exact amendment head run scoped Planner `APPROVE`, then Architect `APPROVE`, then Critic `APPROVE`, verifier, merge and remote deletion. The approved amendment selects an **external auth-gate** as the only executable strict mechanism shape: sole public WSS gate; LiveKit `7880` remains internal-only (`7880 internal`); admission uses account id/room-scoped guest UUID/IP ban-only identity; the browser receives a separate signed gate credential rather than a reusable LiveKit JWT boundary token; PostgreSQL linearization with epoch/no positive cache is mandatory; security>availability; revoke commit before RemoveParticipant/success. The amendment regenerates plan/spec digests, all affected trace/dependency/goal-ledger comparisons and then restarts G05 from amended green `develop`; no G06 or affected successor begins earlier. Failure to make restarted G05 green blocks the unified release.

### 2.4 Legacy reads: disclosed limitation

The no-false-read guarantee applies only to 2.5 cursor-derived state and its conservative projection. Current v2.4.2 room reads write wall-clock `last_read_at` (`apps/api/src/lib/room-store.js:840-863`); current legacy DM read marks every current incoming row (`apps/api/src/lib/friend-store.js:428-437`). Such legacy operations may clear messages the old client did not render; roll-forward cannot reconstruct its render set. 2.5 stores an exact tuple and conservative projection, never regresses it, and reconciles a later legacy wall-clock write monotonically, but explicitly preserves/tests the legacy limitation. New cursor GET paths have no read side effects.

### 2.5 Unicode authority

G06 compares at least two viable RGI data/renderer candidates for license, maintenance, bundle/runtime, update cadence and cross-runtime behavior and records explicit dependency authority. It does not modify manifests. Only G07 may pin the selected package/data and lockfile. Lack of authority blocks reactions, not the truthfulness of the rest of the plan; because reactions are requested scope, final release remains blocked.

## 3. RALPLAN-DR

### Principles

1. Truth before breadth: no false revocation, rollback, read or durability claim.
2. One exact-head safe increment: current goal only; flag-off intermediate; repair before next branch.
3. Additive and staged: active legacy semantics preserved, public capability separate from operator activation, durable data survives rollback.
4. Evidence follows the commit: immutable head-bound CI bundle, later approval envelope and post-merge envelope, checkpoint consolidation, no predicted future evidence or post-approval mutation.
5. Modular monolith with explicit ownership: one codec, one visibility policy, one messaging UoW, distinct domain identities, shared lease primitive, separate worker entrypoints.

### Decision drivers

1. One coherent user-facing minor without three artificial SemVer trains.
2. Security/data/rollback truth across LiveKit, PostgreSQL, push and filesystem.
3. Maximum useful review granularity without splitting atomic invariants.

### Fair alternatives

- **A — one umbrella with nine subsystem branches and four immutable staging checkpoints (chosen).** Coherent product and shared foundations; bounded parallelism with branch-level review/evidence and slice-level targeted tests.
- **B — retain separate 2.5/2.6/2.7 releases.** Earlier learning and smaller public blast radius; repeated release overhead and unwanted intermediate product seams.
- **C — one umbrella with subsystem mega-PRs.** Fewer GitHub operations; unsafe review, repair and rollback. Rejected.
- **D — publicly enable completed waves before v2.5.0.** Earlier feedback; creates unversioned partial releases and contradicts the requested release. Rejected. Internal immutable staging cohorts are allowed.

## 4. ADR-2.5-U001 — unified sequential umbrella

### Decision

Use one marketed 2.5.0, 93 stable requirement/test slices grouped into nine subsystem feature PRs, the dedicated landed-unsealed G01 recovery lineage, and four immutable staging checkpoints. Ordinary pre-merge defects are repaired on the same subsystem branch; material security, persistence, public-contract or production-boundary changes require a scoped amendment. All schema is additive; public features default false; operator writes/workers default false; checkpoints enable only completed prerequisite-closed sets. `release/2.5.0` begins only after the develop-to-release entry goal.

### Drivers

Product cohesion, explicit user request, strict credential truth, behavioral N-1/rescue rollback, independently reviewable changes and reusable modular-monolith foundations.

### Alternatives and why not chosen

Separate trains remain the strongest antithesis but conflict with requested packaging. Mega-PRs and premature public activation violate safe-increment and release-evidence principles. Bounded LKV replay is not an alternative inside this approved scope.

### Consequences

- No public value ships until the whole umbrella is ready; blockers cannot be scope-trimmed silently.
- Strict LKV feasibility can force an amended architecture and new consensus review.
- Literal v2.4.2 binary rollback narrows after temporary-ban activation to an expiry-aware rescue digest; this is disclosed and tested.
- v2.4.2 wall-clock reads retain known false-read limitations; only 2.5 cursor state has the conservative guarantee.
- Larger subsystem PRs reduce repeated CI/review/evidence cost but require G-numbered commits and explicit slice-to-test checklists; four checkpoint holds preserve the primary learning boundaries.
- `.omx` artifacts are planning inputs; tracked docs and externally addressable immutable bundles/envelopes are authoritative during execution.
- Release publication and production promotion are distinct authorities: G12 makes PR/develop/main/release flows side-effect-free, while any later production promotion is manual, environment-gated and immutable-digest-only.

### Follow-ups

Revision 7 keeps alternative A, all 93 goal boundaries, the 93/93 literal-catalog guarantee and the 9/10/15 DAG while making bootstrap state total, candidate evidence non-predictive, terminal selection post-F11 external, recovery explicitly contained and G02 selection-bound. The pair awaits fresh Architect then Critic consensus and authorizes no implementation.


G01 publishes tracked sources; G03 establishes durable evidence before external gates; G05 closes strict LKV or blocks/amends; G06/G07 close dependency authority; G12 decouples publication from production promotion; G42/G50/G71/G90 consolidate wave evidence; G85 freezes the rescue digest; G93 is develop-to-release entry only; the release branch creates and tests the final candidate.

## 5. Ownership, worker and canonical capability/operator DAG

| Concern | Sole owner | Consumers/rule |
| --- | --- | --- |
| Public DTO validation | `packages/shared/src/**` | no HMAC secrets, DB rows or provider internals |
| Opaque cursors | API platform cursor codec | HMAC key rotation/expiry/purpose/context; history/members/inbox/bans/reactors reuse; Web treats string as opaque |
| Message visibility | API messaging visibility policy with room/DM adapters | replies, reactions, attachment read, inbox deep link and moderation deletion reuse it |
| Message writes | Messaging application service | owns transaction; message/mention/inbox/notification-outbox repositories receive injected PostgreSQL client |
| Message delivery identity | message-delivery outbox | distinct event key/revision; not reused as notification identity |
| Notification identity | `user_notifications` + `notification_outbox` | distinct notification/revision/channel; atomic intent created with message UoW |
| Lease lifecycle | API platform lease primitive | fenced claim/renew/loss/retry/shutdown; message, notification and media domains reuse mechanics, not identities/semantics |
| Worker topology | same API image, separate process entrypoints | `message-delivery`, `notification-delivery`, `media-processing`, `media-maintenance`; API listener owns no duplicate timers |
| Canonical DAG | API platform, planned `config/capability-dag.v1.json` | G14 materializes the exact revision-5 manifest below; G92 must parse the same bytes |
| Public capabilities | safe `/api/capabilities`, contract `voice-room.capabilities/v1` | exactly nine stable booleans; unknown/missing=false; no internal/operator key serialized |
| Operator flags | private API configuration/readiness | names may be observable internally, values never public; defaults false |

### 5.1 Stable public contract

The public response contains exactly these keys and no newly invented feature keys: `historyCursor`, `readCursor`, `replies`, `membership`, `engagement`, `reactions`, `mediaRead`, `mediaUploads`, `moderationCenter`. The exact non-public prerequisite nodes are `internal.desktopBoundary`, `internal.idempotentSend`, `internal.messageDelivery`, `internal.structuredContent`, `internal.mentions`, `internal.notificationInbox`, `internal.notificationPolicies`, `internal.unreadNavigation`, `internal.attachmentBinding` and `internal.strictCredential`. Expanding the public set requires a versioned contract and scoped plan amendment. `voice-room.capabilities/v1` is the manifest identity; the wire endpoint preserves the source-compatible `{ contractVersion: 1, apiVersion, features: <nine booleans> }` shape.

| Public key | Binary/schema/index/config prerequisites | API/Web/visibility/worker dependencies | First activation | Safe-read / rollback truth | Replica consensus |
| --- | --- | --- | --- | --- | --- |
| `historyCursor` | API+Web history v1; G24 history indexes; G20 cursor HMAC config | G26/G27 API; G28/G29 Web; G23 visibility; no worker | G42 messaging checkpoint | history reads remain safe with message writes/dispatch off; rollback public false | identical manifest digest and all named prerequisites on every ready API replica |
| `readCursor` | API+Web read v1; G25 read schema/index; G20 cursor config | G30 API; G31 Web; G23 visibility; no worker | G42 | history GET remains safe; `op.readCursor.write=false` stops marks; rollback public false | same unanimous vector |
| `replies` | shared v1 G22; G32 pointer/index schema | G33 API, G34 Web, G23 visibility; G36 idempotency and G37–G40 delivery are internal prerequisites | G42 | existing projections remain readable with `op.reply.write=false`; rollback public false | same unanimous vector |
| `membership` | strict G05 mechanism/config; active-only G43 schema/index | G44 admission, G45 directory, G46 Web, G47/G48 credential, G49 leave; no app worker | G50 membership checkpoint | directory/roster safe when joins/mints stop; revocation remains strict; rollback public false | manifest + strict-provider readiness unanimous |
| `engagement` | G51/G52 content; G55/G56 mention/inbox/outbox schema/index | G53/G57 UoWs; G54/G58/G60/G62/G64/G66 Web; G59/G61 APIs; G38 message and G63 notification workers; G65 cutover; G23 visibility | G71 engagement checkpoint | content/inbox safe reads remain authorized when writes/notification claims stop; public false falls back legacy | manifest + both named worker heartbeats when their claims are desired |
| `reactions` | G67 contract, G68 rows/revision/reactor indexes, G07 Unicode config | G69 API, G70 Web, G23 visibility; no worker | G71 | summaries/lists remain safe when `op.reaction.write=false`; rollback public false | same unanimous vector |
| `mediaRead` | G72 contract, G73 metadata/index, G74 private storage config | G82 authorized API, G84 Web, G23 visibility; no processing worker required for existing ready bytes | G90 media checkpoint | stays safe/available when upload/process/maintenance claims stop; rollback public false hides UI but never weakens auth | manifest + storage/read-config unanimous |
| `mediaUploads` | G72/G73 contract/schema, G74 storage, G75 validation, G76 quota/index | G77 processing, G78/G79/G80 maintenance/pressure, G81 bind, G82 auth, G83 Web; process+maintenance heartbeats | G90 | `mediaRead` remains safe when reserve/claims stop; rollback public false | manifest + both required worker vectors unanimous |
| `moderationCenter` | G85 rescue/config, G86 ban indexes, G87 deletion intent | G86/G87 APIs, G88 Web, G23 visibility, media-maintenance readiness | G90 | active-ban enforcement/unban and deleted-media denial survive UI/write stop; rollback public false and G85 rescue | manifest + expiry-aware rescue digest/readiness unanimous |

The explicit public dependency edges are: `readCursor → historyCursor`; `replies → historyCursor`; `engagement → historyCursor + readCursor + replies + membership`; `reactions → historyCursor + membership`; `mediaRead → historyCursor`; `mediaUploads → historyCursor + mediaRead`; and `moderationCenter → membership + mediaRead`. `historyCursor` and `membership` are public roots. G14 rejects cycles, missing targets and any edge present in only the table or only the manifest.

For every key: `effective = desired_public && binary && schema && index && config && API && Web && visibility && worker_if_named && dependency_edges && replica_consensus`. Any unknown node, dirty schema, stale manifest/config, missing heartbeat/fence or replica disagreement yields false.

### 5.2 Canonical machine-readable manifest

G01 copies this manifest into the tracked plan; G14 materializes the byte-equivalent semantic graph at `config/capability-dag.v1.json` and publishes its SHA-256. G92 rejects any test flag not declared here and generates its covering array from this file.

```json
{
  "contract": "voice-room.capabilities/v1",
  "publicKeys": [
    {
      "key": "historyCursor",
      "owner": "platform.capabilities",
      "requires": {
        "binary": [
          "api.history.v1",
          "web.history.v1"
        ],
        "schema": [
          "G24"
        ],
        "index": [
          "G24"
        ],
        "config": [
          "cursor.hmac"
        ],
        "api": [
          "G26",
          "G27"
        ],
        "web": [
          "G28",
          "G29"
        ],
        "visibility": [
          "G23"
        ],
        "worker": [],
        "internal": []
      },
      "activation": {
        "goal": "G42",
        "checkpoint": "messaging"
      },
      "safeRead": "history with message writes and claims stopped",
      "rollback": {
        "public": false,
        "operators": [
          "op.message.write",
          "op.message.dispatch.claim"
        ]
      },
      "dependsOn": []
    },
    {
      "key": "readCursor",
      "owner": "platform.capabilities",
      "requires": {
        "binary": [
          "api.read.v1",
          "web.read.v1"
        ],
        "schema": [
          "G25"
        ],
        "index": [
          "G25"
        ],
        "config": [
          "cursor.hmac"
        ],
        "api": [
          "G30"
        ],
        "web": [
          "G31"
        ],
        "visibility": [
          "G23"
        ],
        "worker": [],
        "internal": []
      },
      "activation": {
        "goal": "G42",
        "checkpoint": "messaging"
      },
      "safeRead": "history GET with read writes stopped",
      "rollback": {
        "public": false,
        "operators": [
          "op.readCursor.write"
        ]
      },
      "dependsOn": [
        "historyCursor"
      ]
    },
    {
      "key": "replies",
      "owner": "messaging",
      "requires": {
        "binary": [
          "shared.reply.v1",
          "api.reply.v1",
          "web.reply.v1"
        ],
        "schema": [
          "G32"
        ],
        "index": [
          "G32"
        ],
        "config": [],
        "api": [
          "G33"
        ],
        "web": [
          "G34"
        ],
        "visibility": [
          "G23"
        ],
        "worker": [],
        "internal": [
          "internal.idempotentSend",
          "internal.messageDelivery"
        ]
      },
      "activation": {
        "goal": "G42",
        "checkpoint": "messaging"
      },
      "safeRead": "existing reply projection with writes stopped",
      "rollback": {
        "public": false,
        "operators": [
          "op.reply.write"
        ]
      },
      "dependsOn": [
        "historyCursor"
      ]
    },
    {
      "key": "membership",
      "owner": "membership",
      "requires": {
        "binary": [
          "api.membership.v1",
          "web.membership.v1"
        ],
        "schema": [
          "G43"
        ],
        "index": [
          "G43",
          "G45"
        ],
        "config": [
          "strictCredential.G05"
        ],
        "api": [
          "G44",
          "G45",
          "G47",
          "G48",
          "G49"
        ],
        "web": [
          "G46"
        ],
        "visibility": [
          "membership.admission"
        ],
        "worker": [],
        "internal": [
          "internal.strictCredential"
        ]
      },
      "activation": {
        "goal": "G50",
        "checkpoint": "membership"
      },
      "safeRead": "directory and roster with joins and mints stopped",
      "rollback": {
        "public": false,
        "operators": [
          "op.membership.join",
          "op.membership.credentialMint"
        ]
      },
      "dependsOn": []
    },
    {
      "key": "engagement",
      "owner": "engagement",
      "requires": {
        "binary": [
          "shared.engagement.v1",
          "api.engagement.v1",
          "web.engagement.v1"
        ],
        "schema": [
          "G52",
          "G55",
          "G56"
        ],
        "index": [
          "G52",
          "G56",
          "G59"
        ],
        "config": [
          "notification.policy"
        ],
        "api": [
          "G53",
          "G57",
          "G59",
          "G61",
          "G65"
        ],
        "web": [
          "G54",
          "G58",
          "G60",
          "G62",
          "G64",
          "G66"
        ],
        "visibility": [
          "G23"
        ],
        "worker": [
          "message-delivery.G38",
          "notification-delivery.G63"
        ],
        "internal": [
          "internal.idempotentSend",
          "internal.messageDelivery",
          "internal.structuredContent",
          "internal.mentions",
          "internal.notificationInbox",
          "internal.notificationPolicies",
          "internal.unreadNavigation"
        ]
      },
      "activation": {
        "goal": "G71",
        "checkpoint": "engagement"
      },
      "safeRead": "content and inbox with writes and delivery claims stopped",
      "rollback": {
        "public": false,
        "operators": [
          "op.engagement.write",
          "op.notification.dispatch.claim"
        ]
      },
      "dependsOn": [
        "historyCursor",
        "readCursor",
        "replies",
        "membership"
      ]
    },
    {
      "key": "reactions",
      "owner": "engagement.reactions",
      "requires": {
        "binary": [
          "shared.reaction.v1",
          "api.reaction.v1",
          "web.reaction.v1"
        ],
        "schema": [
          "G68"
        ],
        "index": [
          "G68"
        ],
        "config": [
          "unicode.G07"
        ],
        "api": [
          "G69"
        ],
        "web": [
          "G70"
        ],
        "visibility": [
          "G23"
        ],
        "worker": [],
        "internal": []
      },
      "activation": {
        "goal": "G71",
        "checkpoint": "engagement"
      },
      "safeRead": "summaries and reactor lists with writes stopped",
      "rollback": {
        "public": false,
        "operators": [
          "op.reaction.write"
        ]
      },
      "dependsOn": [
        "historyCursor",
        "membership"
      ]
    },
    {
      "key": "mediaRead",
      "owner": "media",
      "requires": {
        "binary": [
          "api.mediaRead.v1",
          "web.mediaRead.v1"
        ],
        "schema": [
          "G73"
        ],
        "index": [
          "G73"
        ],
        "config": [
          "privateStorage.G74"
        ],
        "api": [
          "G82"
        ],
        "web": [
          "G84"
        ],
        "visibility": [
          "G23"
        ],
        "worker": [],
        "internal": [
          "internal.attachmentBinding"
        ]
      },
      "activation": {
        "goal": "G90",
        "checkpoint": "media"
      },
      "safeRead": "authorized ready bytes when all upload workers stop",
      "rollback": {
        "public": false,
        "operators": []
      },
      "dependsOn": [
        "historyCursor"
      ]
    },
    {
      "key": "mediaUploads",
      "owner": "media",
      "requires": {
        "binary": [
          "api.mediaUpload.v1",
          "web.mediaUpload.v1"
        ],
        "schema": [
          "G73"
        ],
        "index": [
          "G73",
          "G76"
        ],
        "config": [
          "privateStorage.G74",
          "mediaLimits.G75"
        ],
        "api": [
          "G75",
          "G76",
          "G81",
          "G82"
        ],
        "web": [
          "G83"
        ],
        "visibility": [
          "G23"
        ],
        "worker": [
          "media-processing.G77",
          "media-maintenance.G78",
          "media-reconciliation.G79",
          "media-pressure.G80"
        ],
        "internal": [
          "internal.attachmentBinding"
        ]
      },
      "activation": {
        "goal": "G90",
        "checkpoint": "media"
      },
      "safeRead": "mediaRead while reserve/process/maintenance stop",
      "rollback": {
        "public": false,
        "operators": [
          "op.media.upload.reserve",
          "op.media.process.claim",
          "op.media.maintenance.claim"
        ]
      },
      "dependsOn": [
        "historyCursor",
        "mediaRead"
      ]
    },
    {
      "key": "moderationCenter",
      "owner": "moderation",
      "requires": {
        "binary": [
          "api.moderation.v1",
          "web.moderation.v1"
        ],
        "schema": [
          "G86",
          "G87"
        ],
        "index": [
          "G86"
        ],
        "config": [
          "rescue.G85"
        ],
        "api": [
          "G86",
          "G87"
        ],
        "web": [
          "G88"
        ],
        "visibility": [
          "G23"
        ],
        "worker": [
          "media-maintenance.G78"
        ],
        "internal": [
          "internal.attachmentBinding"
        ]
      },
      "activation": {
        "goal": "G90",
        "checkpoint": "media"
      },
      "safeRead": "ban enforcement, unban and deleted-media denial when UI/writes stop",
      "rollback": {
        "public": false,
        "operators": [
          "op.moderation.write",
          "op.media.maintenance.claim"
        ]
      },
      "dependsOn": [
        "membership",
        "mediaRead"
      ]
    }
  ],
  "internalPrerequisites": [
    {
      "key": "internal.desktopBoundary",
      "owner": "web.platform",
      "readyWhen": [
        "G16",
        "G17",
        "G18",
        "G19"
      ],
      "requiredBy": [],
      "rollback": false
    },
    {
      "key": "internal.idempotentSend",
      "owner": "messaging",
      "readyWhen": [
        "G36"
      ],
      "requiredBy": [
        "replies",
        "engagement"
      ],
      "rollback": false
    },
    {
      "key": "internal.messageDelivery",
      "owner": "message-delivery",
      "readyWhen": [
        "G37",
        "G38",
        "G39",
        "G40"
      ],
      "requiredBy": [
        "replies",
        "engagement"
      ],
      "rollback": false
    },
    {
      "key": "internal.structuredContent",
      "owner": "engagement.content",
      "readyWhen": [
        "G51",
        "G52",
        "G53",
        "G54"
      ],
      "requiredBy": [
        "engagement"
      ],
      "rollback": false
    },
    {
      "key": "internal.mentions",
      "owner": "engagement.mentions",
      "readyWhen": [
        "G55",
        "G57",
        "G58"
      ],
      "requiredBy": [
        "engagement"
      ],
      "rollback": false
    },
    {
      "key": "internal.notificationInbox",
      "owner": "engagement.notifications",
      "readyWhen": [
        "G56",
        "G57",
        "G59",
        "G60"
      ],
      "requiredBy": [
        "engagement"
      ],
      "rollback": false
    },
    {
      "key": "internal.notificationPolicies",
      "owner": "engagement.notifications",
      "readyWhen": [
        "G61",
        "G62"
      ],
      "requiredBy": [
        "engagement"
      ],
      "rollback": false
    },
    {
      "key": "internal.unreadNavigation",
      "owner": "engagement.navigation",
      "readyWhen": [
        "G66"
      ],
      "requiredBy": [
        "engagement"
      ],
      "rollback": false
    },
    {
      "key": "internal.attachmentBinding",
      "owner": "media",
      "readyWhen": [
        "G72",
        "G73",
        "G81",
        "G82"
      ],
      "requiredBy": [
        "mediaRead",
        "mediaUploads",
        "moderationCenter"
      ],
      "rollback": false
    },
    {
      "key": "internal.strictCredential",
      "owner": "membership.credentials",
      "readyWhen": [
        "G05",
        "G47",
        "G48"
      ],
      "requiredBy": [
        "membership"
      ],
      "rollback": false
    }
  ],
  "operatorFlags": [
    {
      "key": "op.message.write",
      "owner": "messaging",
      "default": false,
      "requiredBy": [
        "replies",
        "engagement"
      ],
      "stop": "new message writes",
      "introducedBy": "G36"
    },
    {
      "key": "op.message.dispatch.claim",
      "owner": "message-delivery",
      "default": false,
      "requiredBy": [
        "engagement"
      ],
      "stop": "new message-delivery claims",
      "introducedBy": "G38"
    },
    {
      "key": "op.readCursor.write",
      "owner": "messaging.read",
      "default": false,
      "requiredBy": [
        "readCursor"
      ],
      "stop": "new explicit read marks",
      "introducedBy": "G30"
    },
    {
      "key": "op.reply.write",
      "owner": "messaging.reply",
      "default": false,
      "requiredBy": [
        "replies"
      ],
      "stop": "new reply pointers",
      "introducedBy": "G33"
    },
    {
      "key": "op.membership.join",
      "owner": "membership",
      "default": false,
      "requiredBy": [
        "membership"
      ],
      "stop": "new joins",
      "introducedBy": "G44"
    },
    {
      "key": "op.membership.credentialMint",
      "owner": "membership.credentials",
      "default": false,
      "requiredBy": [
        "membership"
      ],
      "stop": "new credential mint",
      "introducedBy": "G47"
    },
    {
      "key": "op.engagement.write",
      "owner": "engagement",
      "default": false,
      "requiredBy": [
        "engagement"
      ],
      "stop": "content/mention/inbox writes",
      "introducedBy": "G53"
    },
    {
      "key": "op.notification.dispatch.claim",
      "owner": "notification-delivery",
      "default": false,
      "requiredBy": [
        "engagement"
      ],
      "stop": "provider delivery claims",
      "introducedBy": "G63"
    },
    {
      "key": "op.reaction.write",
      "owner": "engagement.reactions",
      "default": false,
      "requiredBy": [
        "reactions"
      ],
      "stop": "reaction mutation",
      "introducedBy": "G69"
    },
    {
      "key": "op.media.upload.reserve",
      "owner": "media.upload",
      "default": false,
      "requiredBy": [
        "mediaUploads"
      ],
      "stop": "new upload slots",
      "introducedBy": "G76"
    },
    {
      "key": "op.media.process.claim",
      "owner": "media-processing",
      "default": false,
      "requiredBy": [
        "mediaUploads"
      ],
      "stop": "processing claims",
      "introducedBy": "G77"
    },
    {
      "key": "op.media.maintenance.claim",
      "owner": "media-maintenance",
      "default": false,
      "requiredBy": [
        "mediaUploads",
        "moderationCenter"
      ],
      "stop": "cleanup/reconcile claims",
      "introducedBy": "G78"
    },
    {
      "key": "op.moderation.write",
      "owner": "moderation",
      "default": false,
      "requiredBy": [
        "moderationCenter"
      ],
      "stop": "new ban/delete writes",
      "introducedBy": "G86"
    },
    {
      "key": "op.rollout.cohort",
      "owner": "platform.rollout",
      "default": false,
      "requiredBy": [],
      "stop": "new cohort activation",
      "introducedBy": "G42"
    },
    {
      "key": "op.compat.profile",
      "owner": "platform.rollback",
      "default": "normal",
      "enum": [
        "normal",
        "rescue"
      ],
      "requiredBy": [],
      "stop": "normal profile when rescue selected",
      "introducedBy": "G85"
    }
  ],
  "replicaConsensus": {
    "algorithm": "all-ready-API-replicas-report-identical-manifest-digest-and-prerequisite-vector",
    "disagreement": "all-public-false",
    "unknown": "false"
  }
}
```

## 6. Exact-head F0–F11 protocol and three immutable evidence objects

G02 is exceptionally dependent on one valid immutable external bootstrap-selection object emitted strictly after the actual direct-canonical or recovery terminal F11, and bases on that object's exact terminal develop SHA. Every G03–G93 canonical goal and every normal repair phase is operationally dependent on the previous green F11 merge envelope and verified develop SHA. G01 uses the pre-G01 authority/total-partition law below. §9.0 becomes available only in `G01_SELECTED_GREEN`, never merely because candidate files or an F11 filename exist.

- **F0 preflight:** explicit execution handoff; clean worktree; valid `gh auth status`; permission/current-policy review; external-action authority; no active goal. Before G01 this is preceded by the non-circular archive-authority gate below. For every G02+ canonical/repair phase, F0 also proves the predecessor local branch is absent. Live `main`/`develop` have no GitHub branch-protection object, so checks/reviews are process/workflow enforced and must never be described as GitHub-enforced unless a separately authorized settings change is freshly proven. Release merge-commit method authority is required only at G93 and final closure.
- **F1 sync:** checkout/fetch/prune/fast-forward clean `develop`; record base SHA, previous merge-envelope digest and green run; independently record that the predecessor local branch is absent before F2 creates another branch. For G02, the predecessor record is specifically the terminal F11 bound by the valid external direct/recovery selection, and base/origin/develop must equal its `terminal_develop_sha`; any unsealed predecessor is rejected. F11 can prove only the remote deletion.
- **F2 branch:** for a canonical goal create only its exact `feature/2.5.0-gNN-<slug>`; never stack or reuse. A pre-merge G01 failure follows the exceptional bootstrap law, never §9.0. After valid external G01 terminal selection, any failed canonical goal/checkpoint closes its failed branch before §9.0; neither repair branch may coexist with another canonical/repair branch.
- **F3 implement:** all G01–G93 cards have a closed deterministic path catalog. Only the card's **Writable literal paths** may change; **Read-only literal paths** are discovery/consumption anchors and confer no write permission. Both lists are normative exact repository file paths: no line-number suffix, glob, brace expansion, directory alias, fuzzy noun, inferred sibling or unlisted generated file is allowed. A planned or conditional file must be named literally in the owning card before the branch starts; any material discovery that changes the set requires the card's approved amendment or repair path. External URLs, GitHub numeric/node IDs and OCI digests are authorities rather than repository paths. The G01 validator compares card, command, evidence contract and trace row byte-for-byte.
- **F4 targeted:** run the card's exact planned test path/command/job/case IDs/fixtures at its highest proof level.
- **F5 repository:** `npm run check`, `TEST_DATABASE_URL=... npm test`, `npm run build`, plus required E2E/migration/security/media/restore/perf jobs; no required skip.
- **F6 ready PR:** push/open a ready PR to `develop` with exact title, schema/capability/rollback notes and evidence jobs.
- **F7 CI/test bundle:** all required checks emit immutable `ci-bundle.gNN.json` bound to base/head SHA, commands, cases, reports, schema/config/capability/operator state and artifact checksums. It deliberately contains no future review/verifier/merge claim. Any head mutation invalidates F4–F7.
- **F8 parallel `$code-review`:** clean-context `code-reviewer` and `architect` run in parallel on the same F7 head. Merge requires code-reviewer `APPROVE` and architect `CLEAR`. `COMMENT`, `REQUEST CHANGES`, `WATCH`, `BLOCK`, unavailable/stale lane or repair restarts F4–F8 and both lanes. Severity mapping: `CRITICAL=P0`, `HIGH=P1`, `MEDIUM=P2`, `LOW=P2-low`.
- **F9 verifier and approval envelope:** verifier checks the unchanged head, F7 digest, allowlist, acceptance, rollback/migration and both exact review objects. Only after it passes does the seal job emit immutable `approval-envelope.gNN.json` referencing F7 plus reviewer/verifier object IDs, verdicts and SHA. Mutation invalidates F7–F9.
- **F10 squash/remote-delete:** squash-merge the feature PR with exact title; delete the remote branch; checkout `develop`, delete the local branch and fetch/prune. Local deletion is an executor action, not F11 evidence; no next branch exists until its absence is freshly recorded by the next F0/F1.
- **F11 merge envelope:** external CI emits immutable `merge-envelope.gNN.json` for the actual squash/develop SHA, **remote** source-branch deletion, required post-merge checks and links to F7/F9; it never claims local deletion. Failure invokes the G01 exception or §9.0 as applicable; the next canonical goal stays blocked until its F0/F1 proves predecessor local absence. For canonical/recovery G01 only, a distinct external bootstrap-selection object is emitted strictly after a valid actual F11 and becomes G02 authority; no tracked candidate head predicts it. Authorization and fix phases retain distinct deterministic envelopes and no repair renumbers G01–G93.

### Pre-G01 archive-authority gate — no branch, source clock or lineage

Before creating G01, execution is read-only except one explicit ignored handoff record `.omx/context/release-2-5-0-archive-authority.json`; that record is not release evidence and G01 later copies/validates it into tracked `docs/releases/2.5.0/evidence/archive-authority.json`. The gate uses baseline-available `gh`, not any G01-created script. It requires valid `gh auth status`; authenticated API proof that user `dazeGG` owns/administers public repository `dazeGG/VoiceRoom`; Actions is enabled; the workflow-token policy permits the exact future G03 job scope; and `ghcr.io/dazegg/voiceroom-release-evidence` is either absent under authenticated owner/package enumeration or already private, owned by User `dazeGG`, linked only to `dazeGG/VoiceRoom`, and Actions-accessible to that repository. A pre-existing unlinked/cross-repository package or namespace collision fails. Anonymous registry `NAME_UNKNOWN` is recorded only as evidence that anonymous pull cannot resolve a manifest; it is never proof that a private package is absent.

The record contains authenticated API response digests, actor/user/repository IDs, admin authority, Actions/token-policy facts, package state/linkage/visibility, requested package contract digest, explicit user/repository-owner authority for G03 to create/link the exact private package when absent, timestamp and plan/spec hashes. If any authenticated package/API/authority fact is unavailable or mismatched, handoff is `WAITING_EXTERNAL_ARCHIVE_AUTHORITY` **before G01**: no branch, Actions artifact, bootstrap ID or 90-day source clock starts.

### Exceptional G01 bootstrap total partition, chronological selection and recovery containment

Exactly four mutually exclusive and collectively exhaustive states exist. State is determined only by the **current-attempt pointer**, an actual merge in `develop`, and an immutable external terminal-selection object; immutable historical abandoned attempts never make a state overlap:

1. `G01_PRE_BRANCH`: no active/consumed **current** attempt has a first authoritative GitHub PR or workflow-run ID. Any number of immutable historical `ABANDONED_PREMERGE` attempts is allowed and must be used for ordinal reconstruction. At most one unconsumed local preparation or provisional branch/ref may exist here; it has no attempt authority, release-evidence status, artifact-retention clock or consumed ordinal. Before reconstruction/transition, prove by complete GitHub pagination that it has no PR/run ID, delete its local and provisional remote refs, restore the approved baseline and discard its bytes. Failure to prove absence enters the `WAITING_EXTERNAL_BOOTSTRAP_ORDINAL` substatus of `G01_PRE_BRANCH` and creates nothing.
2. `G01_PREMERGE_ACTIVE`: the first authoritative GitHub PR database/node ID or workflow-run ID has atomically consumed the reconstructed ordinal and created the current-attempt pointer binding that immutable ID, exact branch, candidate head SHA, authority digest and plan/spec-pair digest. No merge for that current attempt exists. A second first-ID race or mismatched head/ordinal is conflict evidence, closes the candidate, clears the current pointer only after immutable `ABANDONED_PREMERGE` capture, and returns to waiting `G01_PRE_BRANCH`.
3. `G01_LANDED_UNSEALED`: the current canonical/recovery node has an actual squash merge in `develop`, but no valid immutable external `bootstrap-selection.<attempt-id>.json` exists. This includes F11 pending/missing/invalid/red and the chronological interval after a green terminal F11 but before selection emission.
4. `G01_SELECTED_GREEN`: an immutable external `bootstrap-selection.<attempt-id>.json`, emitted strictly after the actual terminal F11, validates the selected direct/recovery node and exact current `develop` SHA. Only this state activates §9.0 and permits G02.

These predicates form a total partition: no authoritative current ID means `PRE_BRANCH`; authoritative current ID without merge means `PREMERGE_ACTIVE`; actual merge without valid external selection means `LANDED_UNSEALED`; actual merge with valid external selection means `SELECTED_GREEN`. Closing an unmerged attempt clears only the current pointer; its historical PR/run/artifact/failure records remain immutable inputs to the next `PRE_BRANCH` reconstruction.

Before consuming an attempt, paginate all canonical/recovery G01 PRs in open, closed and merged states plus workflow run IDs/run-attempts, retained/expired artifact metadata IDs and external failure references reachable from `develop`. PR database/node IDs, head SHAs, run IDs and immutable merge/head trailers are authority; mutable branch/title strings are discovery only. Persist query variables, every page/cursor, ETags when supplied, response SHA-256 values, immutable IDs, observed maximum and reconstruction digest as candidate-head facts in `bootstrap-attempts.json`. `NN=01` only for a complete empty history; otherwise `NN=1+max(observed ordinal)`, never gap filling. Incomplete pagination, identity conflict or a closed historical PR whose immutable head/ordinal cannot be reconciled yields waiting `G01_PRE_BRANCH`. Lost local preparation has no external ID, consumes no ordinal and is deterministically deleted before recomputation.

Tracked candidate heads contain **known facts only**. `bootstrap-attempts.json` and `bootstrap-landed-recoveries.json` may bind reconstruction digest, historical external failure IDs/digests, current candidate ID/branch/head/base/parent and the first authoritative PR/run ID already observed at that head. They never claim the current head's future reviewer objects, F9, merge/develop SHA, remote deletion, F11 result, terminal status or selection. Prior candidate nodes and imported external failure ID/digest pairs are byte/hash frozen; a new recovery head may append exactly one current-candidate record and update only its current pointer with facts already observed before that head. `bootstrap-lineage.json` is not written by G01/recovery and is never early authority.

After an actual canonical or recovery merge, the post-merge job first emits the real terminal F11 (`merge-envelope.g01.json` or `merge-envelope.bootstrap-recovery-aNN.json`). Strictly afterward, `scripts/evidence/emit-bootstrap-selection.mjs` validates F7, F9, actual merge/develop SHA, remote deletion and the green F11, then emits immutable external Actions object `bootstrap-selection.<attempt-id>.json` against `bootstrap-selection.schema.json`. It binds terminal kind `direct-canonical` or `landed-recovery`, attempt ID, actual terminal F11 ID/digest, F7/F9 IDs/digests, actual merge/develop SHA, remote deletion proof, terminal status `SELECTED_GREEN`, ordered ancestor external failure IDs/digests and `bootstrap_supersession_chain_digest`. No candidate commit contains this object or predicts any field. Missing/invalid/red F11 or failed selection emission stays `G01_LANDED_UNSEALED`.

In `G01_LANDED_UNSEALED`, freeze the landed develop SHA and run a fresh complete Planner→Architect→Critic pair bound to it. Every `feature/2.5.0-g01-postmerge-bootstrap-aNN` attempt uses this exact catalog, imported from and no broader than G01:

- **Recovery writable literal paths:** `docs/RELEASE_2.5.0_PLAN.md`; `docs/RELEASE_2.5.0_TEST_SPEC.md`; `docs/releases/2.5.0/evidence/bootstrap-attempts.json`; `docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json`; `docs/releases/2.5.0/evidence/schema/envelope.schema.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-attempt.schema.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-landed-recovery.schema.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json`; `.github/workflows/ci.yml`; `scripts/test/validate_release_250_plan.py`; `scripts/test/g01-release-docs.test.mjs`; `scripts/test/g01-landed-bootstrap-recovery.test.mjs`; `scripts/test/fixtures/g01-landed-bootstrap-recovery.json`; `scripts/evidence/bootstrap-export.mjs`; `scripts/evidence/validate-envelope.mjs`; `scripts/evidence/recover-landed-bootstrap.mjs`; `scripts/evidence/emit-bootstrap-selection.mjs`.
- **Recovery read-only literal paths:** `.gitignore`; `docs/GIT_FLOW.md`; `docs/RELEASE_2.6.0_PLAN.md`; `docs/RELEASE_2.7.0_PLAN.md`; `docs/releases/2.5.0/evidence/index.json`; `docs/releases/2.5.0/evidence/archive-authority.json`; `docs/releases/2.5.0/evidence/repair-ledger.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-lineage.schema.json`; `docs/releases/2.5.0/evidence/schema/archive-authority.schema.json`; `docs/releases/2.5.0/evidence/schema/archive-map.schema.json`; `docs/releases/2.5.0/evidence/schema/archive-ledger.schema.json`; `docs/releases/2.5.0/evidence/schema/repair-ledger.schema.json`; `docs/releases/2.5.0/evidence/schema/repair-authorization.schema.json`; `docs/releases/2.5.0/evidence/schema/repair-authorization-envelope.schema.json`; `docs/releases/2.5.0/repairs/README.md`; `config/evidence/release-evidence-archive.v1.json`; `scripts/test/g01-oras-lock.test.mjs`; `scripts/ci/run-actionlint.sh`; `config/tool-locks/actionlint-v1.7.12.json`; `scripts/ci/run-oras.sh`; `config/tool-locks/oras-v1.3.3.json`; `.omx/context/release-2-5-0-archive-authority.json`.

The recovery branch bases only on the frozen landed SHA and proves base, target, origin/develop and frozen SHA equality. Its exact command is the G01 command in the G01 card, including `node --test scripts/test/g01-landed-bootstrap-recovery.test.mjs` and `node scripts/evidence/recover-landed-bootstrap.mjs --fixture scripts/test/fixtures/g01-landed-bootstrap-recovery.json --validate-only`. It reruns complete targeted/repository gates, F7, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier/F9, squash merge, remote deletion, distinct recovery F11 and only then external selection emission. A pre-merge recovery failure closes/deletes, records an external failure object and remains `G01_LANDED_UNSEALED`; the next candidate imports the prior ID/digest without rewriting it. A merged recovery whose F11/selection fails appends a landed ancestor and repeats from the new SHA. No normal repair or `R-G01-MM` is available before external terminal selection.

G02 consumes exactly one valid external selection disjunction: direct canonical `bootstrap-selection.<attempt-id>.json` bound to green `merge-envelope.g01.json`, or landed recovery selection bound to green `merge-envelope.bootstrap-recovery-aNN.json`. Its branch base and origin/develop must equal `terminal_develop_sha`; every unsealed ancestor SHA is rejected. G03 archives that selection object plus all ordered ancestor external failure objects and selected G01/G02 F7/F9/F11 bytes. Only G93 later materializes tracked `bootstrap-lineage.json` as a summary/validator output; it is never the authority that admitted G02 or G03.

Required fixtures cover first attempt, historical abandoned premerge, lost local preparation, provisional-ref cleanup, closed historical PR, identity-conflict waiting, all four partition states, direct selection, post-F11/pre-selection landed interval, repeated recovery failure, wrong recovery base/catalog/path, develop drift, predicted future field in a candidate head, fabricated F11/selection, pre-green repair, G02 from every unsealed ancestor, missing ancestry and relabel attempts.

### Bootstrap chronology and early durable evidence transition

G01 may change only its canonical literal catalog; recovery uses the exact frozen subset declared above. Candidate registries contain known pre-merge facts only. G01 and G02 emit F7/F9/F11 as SHA-256-addressed GitHub Actions objects under the live 90-day maximum; after terminal G01 F11, the external bootstrap-selection object is emitted chronologically and none claims OCI. G03 immediately follows G02 and must close before those bytes expire. If the first real GHCR push/linkage/attestation/digest recovery cannot close G03 before expiry, abandon the complete G01–G03 lineage and return to fresh scoped consensus/bootstrap with new IDs and evidence; never regenerate, relabel or fabricate expired bytes.

After green G03, every selected G01/G02 object exists byte-for-byte in the exact digest-addressed GHCR archive. From G03 onward OCI is the evidence primary through v2.5.0 support plus at least one year; Actions is only a cache. The hostile >90-day oracle deletes Actions and recovers solely from OCI. G01 bootstrap remains chronological: tracked candidate head contains known facts only; F7 contains no future verdict; F9 follows exact-head reviews/verifier; F11 follows actual merge and remote deletion; external selection follows F11. G02 proves local absence and exact terminal-selection SHA before branching.

### Pinned actionlint bootstrap

G01 owns `scripts/ci/run-actionlint.sh` and `config/tool-locks/actionlint-v1.7.12.json`; G02, G03, G08, G11 and G12 may execute those files read-only but may not edit them. The lock records: owner/repository `rhysd/actionlint`; tag/version `v1.7.12`; tag commit `914e7df21a07ef503a81201c76d2b11c789d3fca`; release ID `303326868`; asset `actionlint_1.7.12_linux_amd64.tar.gz`, asset ID `384924896`, size `2353908`, SHA-256 `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`; checksum-asset ID `384924918` and checksum-asset digest `433028cf0ba3c42163ea1a668dedce30fcdbe84fe912b1a5e288c006eab8a4f5`; official release URL `https://github.com/rhysd/actionlint/releases/tag/v1.7.12`; release API `https://api.github.com/repos/rhysd/actionlint/releases/303326868`; binary-asset API `https://api.github.com/repos/rhysd/actionlint/releases/assets/384924896`; checksum-asset API `https://api.github.com/repos/rhysd/actionlint/releases/assets/384924918`; binary download URL `https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz`; tag-ref API `https://api.github.com/repos/rhysd/actionlint/git/ref/tags/v1.7.12`; observation date `2026-07-18`.

The wrapper downloads only `https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz`, checks exact byte size, runs mandatory `sha256sum --check --strict` against the locked archive digest, runs mandatory `gh attestation verify <archive> -R rhysd/actionlint`, extracts only the expected binary, requires its normalized version output to equal `v1.7.12`, verifies locked tag/release/asset metadata, and only then lints the passed workflow paths. There is no implicit `latest`, `npx`, package-manager fetch or attestation/checksum bypass. Missing network, asset, `gh`, attestation, checksum utility, metadata or version is a hard bootstrap failure.

### Pinned ORAS and exact GHCR evidence contract

G01 owns literal `scripts/ci/run-oras.sh`, `config/tool-locks/oras-v1.3.3.json`, `config/evidence/release-evidence-archive.v1.json`, archive/authority schemas and tests. G03 consumes them read-only. The wrapper accepts HTTPS only and pins official ORAS v1.3.3: archive `oras_1.3.3_linux_amd64.tar.gz` SHA-256 `9ce999f8d2de03fc03968b29d743077a58783e545e5eaa53917ca177352d0e59`; detached archive signature `oras_1.3.3_linux_amd64.tar.gz.asc` SHA-256 `4b101042ee0b95b893de6f0ce6a4ec6ddfbff98df1ed23389de6c4e1ec1c1baf`; separately hash-pinned `oras_1.3.3_checksums.txt` SHA-256 `5cf7ff102a941bdb35e8eabfc8cbe937c5387d20e7a2ee75dc4be90410e462cd`; signer fingerprint `2DA461D13B0C27845EDFA77FE462A3894CBAAA47`; `KEYS` SHA-256 `e901b09b9c6dbe6e068b4ca8dbd93dc761acbccc1439c032226981f0b476fa70`; annotated tag object `d6f59b4e6615cadfc8343dc9a066d781300c5967`; source commit `210747c29c1d38732b3194878dfd8b5a6b9ad7eb`. Official HTTPS sources are `https://github.com/oras-project/oras/releases/tag/v1.3.3`, `https://github.com/oras-project/oras/releases/download/v1.3.3/oras_1.3.3_linux_amd64.tar.gz`, `https://github.com/oras-project/oras/releases/download/v1.3.3/oras_1.3.3_linux_amd64.tar.gz.asc`, `https://github.com/oras-project/oras/releases/download/v1.3.3/oras_1.3.3_checksums.txt` and immutable-commit `https://raw.githubusercontent.com/oras-project/oras/210747c29c1d38732b3194878dfd8b5a6b9ad7eb/KEYS`. It verifies every locked download/hash, the detached archive signature against the archive via GPG `VALIDSIG` with exact fingerprint, tag object/commit and exact ORAS version+commit; no `latest`, fallback or package-manager resolution. ORAS binary itself is never attested as release evidence.

The sole primary evidence package is private repository-linked GHCR package `ghcr.io/dazegg/voiceroom-release-evidence`, owned by User `dazeGG` and linked only to public repository `dazeGG/VoiceRoom`. Primary objects are standalone OCI artifacts—no subject/referrer is required—with artifact type `application/vnd.voiceroom.release-evidence.v1+json`, one JSON layer media type `application/json`, and exact annotations `org.opencontainers.image.source=https://github.com/dazeGG/VoiceRoom`, `org.opencontainers.image.revision=<source-sha>`, `io.voiceroom.github.run-id=<run-id>`, `io.voiceroom.github.run-attempt=<run-attempt>` and `io.voiceroom.evidence.id=<object-id>`. Discovery tag grammar is `evidence-<lower-object-id>-<sha256-12>-run<run-id>-attempt<run-attempt>`; every tag is unique and never reused, but the manifest digest is the sole authority. Push, pull, verification and manifest fetch use the digest, never a tag.

G03 job permissions are exactly `contents: read`, `packages: write`, `id-token: write`, `attestations: write`; every unlisted scope is `none`. Login uses only the repository `GITHUB_TOKEN`; no PAT, registry secret or repository secret is permitted. `actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6` attests the pushed manifest digest and verification pulls/verifies from OCI; it does not attest the ORAS binary. The workflow contains no package-delete step/API. GHCR digest storage is immutable-addressed but not WORM/tamper-proof: package/repository admins may delete and restore only within GitHub limits. Therefore the append-only ledger, retention governance through v2.5 support plus at least one year, scheduled sentinel and actor/visibility/linkage/digest/attestation drift checks are mandatory; deletion/unavailability hard-stops and requires a new approved lineage.

This evidence package is distinct from G11 runtime packages `ghcr.io/dazegg/voiceroom-api`, `ghcr.io/dazegg/voiceroom-web` and `ghcr.io/dazegg/voiceroom-worker`. Runtime images/SBOM/provenance never share the evidence package, media type, ledger or retention role.

### Revision 6 exact archive, promotion and expiry decision contract

This section is normative and supersedes any shorter earlier description.

#### Digest-first ORAS publication sequence

Every evidence object is compact UTF-8 JSON with no BOM or trailing LF and frozen field order before network access. It uses OCI image manifest schema v1.1, manifest media type `application/vnd.oci.image.manifest.v1+json`, the frozen evidence artifact type, no subject/referrer, config bytes exactly `{}` with media type `application/vnd.oci.empty.v1+json`, size `2` and digest `sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`; it has exactly one original-byte layer with media type `application/json`, exact byte size/SHA-256 and title annotation. The layer and manifest digests are computed before the first network write.

The only accepted order is: (1) authenticate and calculate every descriptor; (2) `oras blob push --media-type application/vnd.oci.empty.v1+json --descriptor "$REPO@$EMPTY_DIGEST" empty.json`, then immediately re-prove owner/linkage before another write; (3) push the original layer blob by digest and media type; (4) `oras manifest push --media-type application/vnd.oci.image.manifest.v1+json --descriptor "$REPO@$MANIFEST_DIGEST" manifest.json` by digest only, without a tag or generic `oras push`; (5) fetch the manifest by digest and byte-compare it, then fetch/pull the layer by digest and byte-compare it; (6) attest and verify the exact manifest digest; (7) only then run `oras tag "$REPO@$MANIFEST_DIGEST" "$DISCOVERY_TAG"` and resolve that tag once to the same digest; (8) append the authoritative ledger last. Tag-first publication, tag-based proof, generic push, nondeterministic/reserialized bytes, subject/referrer use or ledger mutation before digest proof fails.

#### Post-approval policy revalidation before credentials

Any future promotion job's first post-environment-approval step is credentialless: it receives no secret, OIDC token, production endpoint, build/deploy ability or reusable-workflow secret input and uses the frozen job `GITHUB_TOKEN` only to re-fetch repository/owner IDs; exact ref, tag object and peeled SHA; workflow path, tag-resolved blob, `github.workflow_ref` and `github.workflow_sha`; immutable app digests; environment ID, branch/tag policy, reviewer actor IDs, `prevent_self_review`, admin-bypass setting, dispatcher/approval/deployment IDs; and the frozen permission vector. These facts bind `post-approval-policy-envelope.json`. Only an exact match sets in-memory `credential_step_allowed=true`; the immediately following step is the sole credential consumer, with no intervening step, wait, global environment variable or earlier credential expression. Drift or unavailable authority leaves the credential step disabled and reads no secret. The current release executes no promotion.

#### G03 pre-expiry repair versus lineage abandonment

A normal `R-G03-MM` is repairable only before the earliest immutable source expiry while every G01/G02 source byte still fetches and hashes exactly, authority is unchanged, every partial uploaded digest byte matches, and no discovery-tag collision or ledger conflict exists. Repairable examples are transient network/runner/API failure, cancellation, ordinary G03 test/review/verifier failure, a G03 code defect, missing tag/attestation/ledger for the unchanged exact manifest, or an incomplete exact partial upload. Resume is digest-idempotent or a full rerun from the identical original bytes; it never regenerates or reserializes evidence. A temporarily unavailable API may pause only until the expiry boundary. A missing attestation is repairable only while the exact manifest is unchanged.

Lineage abandonment is mandatory for missing, expired, tampered or reserialized source bytes; inability to close before expiry; owner/visibility/linkage/actor/token-policy drift; wrong or reused tag; remote blob/manifest mismatch, unavailability or deletion; wrong media, annotation or object binding; conflicting authoritative ledger; present-but-mismatched attestation; or post-green sentinel/retention drift. These failures never enter `R-G03-MM`; they freeze immutable failure evidence and restart the approved bootstrap lineage. Fixtures distinguish incomplete exact upload from remote mismatch, missing from mismatched attestation, and transient API recovery before versus after expiry.

### Live GitHub control-plane facts (2026-07-18)

Read-only API evidence records Actions artifact retention `days=90` and `maximum_allowed_days=90`; anonymous GHCR currently returns `NAME_UNKNOWN` for the evidence name but that is not authenticated proof of absence; zero GitHub environments with `production` returning 404; and no branch-protection object for `main` or `develop`. The current baseline `main` workflow still auto-deploys through the legacy SSH/build job; this remains an explicit unresolved fact until G12 removes every reference. G03 removes the retention dependency before unbounded gates. G12 treats optional promotion as `PROMOTION_DISABLED_EXTERNAL_AUTHORITY` until a separately authorized live policy exists. Reviews/checks remain mandatory process/workflow evidence, but no plan or release artifact may claim GitHub-enforced branch protection without a fresh separately authorized settings proof.

### Three-object durable chain

1. `ci-bundle.gNN.json`: head-bound tests/build/schema/config/capability/operator inputs and output checksums; no review/verifier/merge fields.
2. `approval-envelope.gNN.json`: created after F8 and verifier, references the exact F7 digest and immutable GitHub reviewer/verifier identities/verdicts/SHA.
3. `merge-envelope.gNN.json`: created only after F10, names actual squash/develop SHA and branch deletion/post-merge checks, and references both F7 and F9 digests.
4. Canonical/recovery G01 adds an exceptional immutable external bootstrap-selection object strictly after terminal F11. G03 archives that selection, ordered ancestor failure objects and the G01/G02 ID/SHA→OCI map. G42/G50/G71/G90 and G93 append canonical plus repair checksums/OCI URLs; `.omx`, tracked candidate summaries, mutable names, expired-cache regeneration or predicted future facts never close a gate.

## 7. Dependency waves and checkpoints

```text
canonical+evidence bootstrap -> autonomous CI -> durable evidence archive -> LiveKit harness -> strict LKV ADR
  -> dependency authority -> quality/ownership -> runtime image/SBOM publication -> release/deploy boundary -> runtime/capability DAG/migrations
  -> platform contract -> platform persistence -> desktop boundary/physical matrix
  -> cursor/visibility/contracts/schema/API/Web/replies/idempotency/outbox-intent/worker/shadow/cutover/bans
  -> G42 immutable messaging checkpoint
  -> active-only membership/admission/directory/roster/strict cutover/leave
  -> G50 immutable membership checkpoint
  -> content contract -> content persistence -> content UoW/Web -> mention/inbox/inert-outbox schema -> atomic UoW -> policy/dispatch
  -> reaction contract -> reaction persistence -> API/Web
  -> G71 immutable engagement checkpoint
  -> attachments/storage/upload/worker/cleanup/reconcile/pressure/binding/access/UI
  -> G85 expiry-aware rescue -> temporary bans -> deletion -> moderation -> restore
  -> G90 immutable media checkpoint -> G91 budgets -> G92 manifest-derived activation -> G93 entry gate
```

A checkpoint deploys immutable digests, enables only the completed prerequisite-closed set from `config/capability-dag.v1.json`, runs all-off/pairwise/N-1/failure profiles and observes ≥60 minutes. Failure is repaired inside the current wave before another planned branch. Public production remains unchanged.

## 8. Goal ledger

Each card includes current brownfield integration files and executable planned evidence. Planned test files may be introduced by that goal; G02/G08/G09 establish the runners. Common exit is F0–F11 plus the card-specific artifact.

### G01 — canonical unified plan

- **Branch:** `feature/2.5.0-g01-canonical-evidence-bootstrap`.
- **PR title:** `ci(release): publish the unified plan and bootstrap evidence`.
- **Depends on:** green pre-G01 archive-authority gate `WAITING_EXTERNAL_ARCHIVE_AUTHORITY` absent, explicit authority record digest, approved RALPLAN consensus, green current baseline jobs `policy`, `check`, `test`, and deterministic bootstrap attempt ID; no predecessor envelope exists.
- **Objective:** Publish tracked revision-7 canonical plan/spec, exact literal-path validator, total four-state bootstrap partition, candidate-only registries, recovery catalog/tests and schemas/scripts for a strictly post-F11 external selection object without pushing GHCR.
- **Writable literal paths:** `docs/RELEASE_2.5.0_PLAN.md`; `docs/RELEASE_2.5.0_TEST_SPEC.md`; `docs/RELEASE_2.6.0_PLAN.md`; `docs/RELEASE_2.7.0_PLAN.md`; `docs/releases/2.5.0/evidence/index.json`; `docs/releases/2.5.0/evidence/bootstrap-attempts.json`; `docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json`; `docs/releases/2.5.0/evidence/archive-authority.json`; `docs/releases/2.5.0/evidence/repair-ledger.json`; `docs/releases/2.5.0/evidence/schema/envelope.schema.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-lineage.schema.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-attempt.schema.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-landed-recovery.schema.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json`; `docs/releases/2.5.0/evidence/schema/archive-authority.schema.json`; `docs/releases/2.5.0/evidence/schema/archive-map.schema.json`; `docs/releases/2.5.0/evidence/schema/archive-ledger.schema.json`; `docs/releases/2.5.0/evidence/schema/repair-ledger.schema.json`; `docs/releases/2.5.0/evidence/schema/repair-authorization.schema.json`; `docs/releases/2.5.0/evidence/schema/repair-authorization-envelope.schema.json`; `docs/releases/2.5.0/repairs/README.md`; `config/evidence/release-evidence-archive.v1.json`; `.github/workflows/ci.yml`; `scripts/test/validate_release_250_plan.py`; `scripts/test/g01-release-docs.test.mjs`; `scripts/test/g01-oras-lock.test.mjs`; `scripts/test/g01-landed-bootstrap-recovery.test.mjs`; `scripts/test/fixtures/g01-landed-bootstrap-recovery.json`; `scripts/evidence/bootstrap-export.mjs`; `scripts/evidence/validate-envelope.mjs`; `scripts/evidence/recover-landed-bootstrap.mjs`; `scripts/evidence/emit-bootstrap-selection.mjs`; `scripts/ci/run-actionlint.sh`; `config/tool-locks/actionlint-v1.7.12.json`; `scripts/ci/run-oras.sh`; `config/tool-locks/oras-v1.3.3.json`.
- **Read-only literal paths:** `.gitignore`; `docs/GIT_FLOW.md`; `.omx/context/release-2-5-0-archive-authority.json`.
- **Explicit non-goals:** No application/schema/product runtime, autonomous full stack, GHCR push/package creation, runtime image, environment-policy mutation or deployment. A pre-merge G01 failure never uses §9.0 or `R-G01-MM`; the current legacy `main` deploy remains unresolved until G12. No implicit latest, unverified fallback or ORAS binary attestation.
- **Acceptance criteria:** The validator proves the four predicates form a total mutually exclusive partition with historical abandoned attempts and unconsumed preparation inside `G01_PRE_BRANCH`; first authoritative PR/run ID atomically enters `G01_PREMERGE_ACTIVE`; actual merge without selection is `G01_LANDED_UNSEALED`; and only a valid post-F11 external selection is `G01_SELECTED_GREEN`. Tracked `bootstrap-attempts.json` and `bootstrap-landed-recoveries.json` contain known candidate/ancestor facts only and reject their own future F9/merge/deletion/F11/terminal fields. `bootstrap-lineage.json` is absent from the G01/recovery writable catalog. Direct and recovery F11 then external selection chronology, recovery subset containment, exact terminal SHA for G02, 93 cards/rows and all retained archive/promotion/G05 contracts validate.
- **Targeted verification:** planned test `scripts/test/validate_release_250_plan.py`; exact command: `python3 scripts/test/validate_release_250_plan.py docs/RELEASE_2.5.0_PLAN.md docs/RELEASE_2.5.0_TEST_SPEC.md && node --test scripts/test/g01-release-docs.test.mjs scripts/test/g01-oras-lock.test.mjs && node --test scripts/test/g01-landed-bootstrap-recovery.test.mjs && node scripts/evidence/recover-landed-bootstrap.mjs --fixture scripts/test/fixtures/g01-landed-bootstrap-recovery.json --validate-only && node scripts/evidence/validate-envelope.mjs --fixture bootstrap && scripts/ci/run-actionlint.sh .github/workflows/ci.yml && scripts/ci/run-oras.sh version`; required job: `bootstrap-plan`; case IDs `G01-A01`, `G01-A02`; fixtures: first attempt, historical abandoned premerge, lost local preparation, provisional-ref cleanup, closed historical PR, identity-conflict WAITING, all four partition states, direct selection, post-F11/pre-selection interval, repeated recovery, wrong frozen base/catalog/path, develop drift, predicted future candidate field, fabricated F11/selection, missing ancestry, relabel and G02 from every unsealed ancestor; highest proof **P3**; expected artifacts `ci-bundle.g01.json`, `approval-envelope.g01.json`, `merge-envelope.g01.json`, candidate-registry/authority/schema/recovery-command reports, post-F11 external `bootstrap-selection.<attempt-id>.json`, actionlint/ORAS reports, SHA-256 and GitHub Actions artifact IDs.
- **Capability / rollback:** No product capability. Lost unconsumed preparation and abandoned premerge history return to `G01_PRE_BRANCH`; a landed node remains `G01_LANDED_UNSEALED` through F11/selection failure. No nonterminal state permits normal repair or G02; only a valid external selection enters `G01_SELECTED_GREEN`.
- **Review-loop exit:** The candidate head emits F7 only; F9 follows reviews/verifier; actual direct/recovery merge, remote deletion and F11 follow; then and only then external selection binds the terminal SHA and supersession digest. Failure before merge abandons; failure after merge remains landed-unsealed. G02 must consume the exact selection object.

### G02 — autonomous ci foundation

- **Branch:** `feature/2.5.0-g02-autonomous-ci-foundation`.
- **PR title:** `ci: add autonomous clean-stack verification`.
- **Depends on:** G01; operationally, exactly one valid external `bootstrap-selection.<attempt-id>.json`: either `direct-canonical` bound to green `merge-envelope.g01.json`, or `landed-recovery` bound to green `merge-envelope.bootstrap-recovery-aNN.json`; origin/develop must equal its `terminal_develop_sha`, and every unsealed ancestor SHA is rejected.
- **Objective:** Consume and validate the exact post-F11 terminal bootstrap-selection disjunction, base on its terminal develop SHA, then provide autonomous full-stack CI and chronological envelope jobs.
- **Writable literal paths:** `.github/workflows/ci.yml`; `docker-compose.ci.yml`; `apps/web/playwright.config.ts`; `apps/web/e2e/helpers.ts`; `scripts/evidence/export-goal-evidence.mjs`; `scripts/evidence/seal-approval-envelope.mjs`; `scripts/evidence/emit-merge-envelope.mjs`; `scripts/test/g02-ci-contract.test.mjs`.
- **Read-only literal paths:** `docs/RELEASE_2.5.0_PLAN.md`; `docs/RELEASE_2.5.0_TEST_SPEC.md`; `docs/releases/2.5.0/evidence/bootstrap-attempts.json`; `docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json`; `docs/releases/2.5.0/evidence/schema/envelope.schema.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json`; `scripts/evidence/bootstrap-export.mjs`; `scripts/evidence/emit-bootstrap-selection.mjs`; `scripts/evidence/validate-envelope.mjs`; `scripts/ci/run-actionlint.sh`; `config/tool-locks/actionlint-v1.7.12.json`; `docker-compose.yml`; `package.json`; `apps/web/package.json`.
- **Explicit non-goals:** No product behavior, LKV decision, OCI evidence claim, Firefox/WebKit required-PR matrix or production deploy; no edit to the G01-owned actionlint wrapper/tool lock.
- **Acceptance criteria:** A clean runner starts its own stack, runs baseline Chromium twice without retry, tears down on failure and emits F7/F9/F11 envelopes through the G01 mechanism; G01/G02 objects remain SHA-addressed GitHub artifacts only until the immediately following G03 import. Before any G02 edit/run, validate selection schema, terminal F11/F7/F9/remote deletion/supersession digest and exact origin/develop equality. Direct canonical and terminal recovery objects pass; missing/invalid selection, every unsealed ancestor SHA including the original landed merge and any intermediate recovery merge, stale head or tracked `bootstrap-lineage.json` summary fails.
- **Targeted verification:** planned test `scripts/test/g02-ci-contract.test.mjs`; exact command: `node --test scripts/test/g02-ci-contract.test.mjs && scripts/ci/run-actionlint.sh .github/workflows/ci.yml`; required job: `goal-g02`; case IDs `G02-A01`, `G02-A02`; fixtures: empty runner, stale selector, readiness timeout, failed teardown; highest proof **P3**; expected artifacts `ci-bundle.g02.json`, `approval-envelope.g02.json`, `merge-envelope.g02.json`, test report, SHA-256 and GitHub Actions artifact IDs. Additional fixtures include direct-canonical selection, terminal recovery selection, post-F11 selection emission, no selection, red/invalid F11, each unsealed ancestor SHA, stale origin/develop and forged tracked summary.
- **Capability / rollback:** CI rollback retains existing check/test jobs; no capability changes.
- **Review-loop exit:** F0/F1 first bind the immutable external selection ID/digest and require branch base/origin/develop equal `terminal_develop_sha`; only then normal G02 F7, reviews, F9, merge/deletion and F11 may close.

### G03 — durable evidence archive

- **Branch:** `feature/2.5.0-g03-durable-evidence-archive`.
- **PR title:** `ci(evidence): establish the durable release archive`.
- **Depends on:** G02; operationally, green G02 merge envelope and every G01/G02 GitHub artifact still byte-addressable.
- **Objective:** Use the pre-authorized exact private repository-linked GHCR package to import every selected G01/G02 F7/F9/F11 byte-for-byte as standalone digest-authoritative OCI artifacts, attest/verify manifest digests, and establish append-only retention/sentinel governance before any unbounded gate.
- **Writable literal paths:** `docs/releases/2.5.0/evidence/index.json`; `docs/releases/2.5.0/evidence/archive-map.json`; `docs/releases/2.5.0/evidence/archive-ledger.json`; `.github/workflows/evidence-archive.yml`; `.github/workflows/evidence-archive-sentinel.yml`; `scripts/evidence/archive-to-oci.mjs`; `scripts/evidence/recover-from-oci.mjs`; `scripts/evidence/check-archive-sentinel.mjs`; `docs/operations/EVIDENCE_ARCHIVE.md`; `scripts/test/g03-evidence-archive.test.mjs`.
- **Read-only literal paths:** `docs/RELEASE_2.5.0_PLAN.md`; `docs/RELEASE_2.5.0_TEST_SPEC.md`; `docs/releases/2.5.0/evidence/bootstrap-attempts.json`; `docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json`; `docs/releases/2.5.0/evidence/archive-authority.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json`; `docs/releases/2.5.0/evidence/schema/archive-map.schema.json`; `docs/releases/2.5.0/evidence/schema/archive-ledger.schema.json`; `config/evidence/release-evidence-archive.v1.json`; `scripts/evidence/export-goal-evidence.mjs`; `scripts/evidence/validate-envelope.mjs`; `scripts/ci/run-actionlint.sh`; `config/tool-locks/actionlint-v1.7.12.json`; `scripts/ci/run-oras.sh`; `config/tool-locks/oras-v1.3.3.json`.
- **Explicit non-goals:** No strict-LKV/dependency work, runtime image/SBOM package, subject/referrer requirement, PAT/registry/repository secret, package deletion API/step, WORM/tamper-proof claim, ORAS binary attestation, production promotion, expired-byte regeneration or edit to G01-owned actionlint/ORAS wrappers, locks, contract or schemas.
- **Acceptance criteria:** The first real `GITHUB_TOKEN` push is final package capability/linkage proof. The package is private, owned by User `dazeGG`, linked only to public `dazeGG/VoiceRoom`; every object uses artifact type `application/vnd.voiceroom.release-evidence.v1+json`, JSON layer `application/json`, exact source/revision/run/run-attempt/evidence-ID annotations and a never-reused discovery tag, while manifest digest alone authorizes push/pull/fetch. G03 job permissions are exactly `contents: read`, `packages: write`, `id-token: write`, `attestations: write`; no PAT/secret. Pinned `actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6` attests each manifest digest and OCI pull verifies it. Append-only ledger, ≥1-year-plus-v2.5-support governance and scheduled sentinel detect actor/visibility/linkage/digest/attestation drift; workflow has no delete. Digest storage is deletion-capable, not WORM: deletion/unavailability hard-stops. A >90-day Actions-purged fixture recovers solely by OCI digest without regeneration. If G03 cannot close before source expiry, the entire G01–G03 lineage is abandoned for new consensus/bootstrap. Publication follows the exact digest-first blob/config/layer/manifest/fetch/attest/tag/ledger sequence above. It imports the exact external terminal bootstrap-selection object plus every ordered ancestor external failure object and selected G01/G02 F7/F9/F11 byte; tracked candidate files are context, never selection authority. Repairability is decided before earliest source expiry from exact immutable bytes and unchanged authority; every abandonment condition freezes the lineage rather than entering normal repair.
- **Targeted verification:** planned test `scripts/test/g03-evidence-archive.test.mjs`; exact command: `node --test scripts/test/g03-evidence-archive.test.mjs && scripts/ci/run-actionlint.sh .github/workflows/evidence-archive.yml .github/workflows/evidence-archive-sentinel.yml && scripts/ci/run-oras.sh version`; required job: `goal-g03-evidence-archive`; case IDs `G03-A01`, `G03-A02`; fixtures: authenticated missing-authority/invalid-gh/token-policy denial, package absent with authority, pre-existing unlinked/cross-repo namespace, visibility/linkage/actor drift, exact permissions and GITHUB_TOKEN login, ORAS archive/archive-signature/checksums/immutable-KEYS tamper, standalone media/annotations, mutable/reused tag, digest push/pull/manifest fetch, pinned attestation success/failure, deletion/sentinel failure, complete G01/G02 F7/F9/F11, >90-day deleted Actions cache, expired-before-close and separate runtime-package names; highest proof **P3**; expected artifacts `ci-bundle.g03.json`, `approval-envelope.g03.json`, `merge-envelope.g03.json`, authenticated package/linkage report, append-only archive ledger/map, sentinel/retention/attestation/digest-recovery reports and OCI evidence digest. Additional fixtures cover direct/recovery external selection plus ancestor failures, tracked summary substituted as authority, missing selection/F11/ancestor, compact-byte determinism, exact empty-config digest, tag-first/generic-push/subject rejection, ledger-before-proof rejection, incomplete exact partial upload, remote mismatch, missing versus mismatched attestation and transient API recovery on both sides of expiry.
- **Capability / rollback:** Evidence durability only. Before earliest expiry, exact-byte transient failures may use bounded `R-G03-MM`; source/authority/remote/ledger/attestation/sentinel abandonment conditions require a new approved lineage. No evidence byte is regenerated or relabeled.
- **Review-loop exit:** OCI-primary F7, parallel code-reviewer `APPROVE` + architect `CLEAR`, verifier, F9 and F11 must prove the first actual package push, linkage, manifest attestation, G01/G02 digest-only recovery and scheduled sentinel before G04; failure before expiry abandons the whole selected lineage.

### G04 — livekit replay harness

- **Branch:** `feature/2.5.0-g04-livekit-replay-harness`.
- **PR title:** `test(livekit): add the production-equivalent replay harness`.
- **Depends on:** G03; operationally, green G03 merge envelope and durable archive recovery proof.
- **Objective:** Add a reproducible pinned LiveKit topology and harness that mints, connects, removes/revokes and retries the same token.
- **Writable literal paths:** `docker-compose.lkv.yml`; `apps/api/test/g04-livekit-replay.test.js`; `scripts/lkv/start-replay-topology.mjs`; `scripts/lkv/run-replay-scenario.mjs`; `scripts/lkv/partition-proxy.mjs`; `scripts/lkv/collect-replay-evidence.mjs`; `.github/workflows/ci.yml`.
- **Read-only literal paths:** `docker-compose.yml`; `apps/api/src/server.js`; `apps/api/src/lib/config.js`.
- **Explicit non-goals:** No mechanism selection, membership schema, provider purchase or public route change.
- **Acceptance criteria:** Harness records same-token baseline reconnect behavior for remove, permission change, ban/leave simulation, restart, partition and clock skew on pinned v1.13.2.
- **Targeted verification:** planned test `apps/api/test/g04-livekit-replay.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g04-livekit-replay.test.js`; required job: `goal-g04`; case IDs `G04-A01`, `G04-A02`; fixtures: pinned LiveKit v1.13.2, already-issued JWT, restart/partition proxy; highest proof **P3**; expected artifacts `ci-bundle.g04.json`, `approval-envelope.g04.json`, `merge-envelope.g04.json`, test report and OCI evidence digest.
- **Capability / rollback:** Harness is test-only and removable; public behavior/capabilities unchanged.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G05 — strict livekit adr

- **Branch:** `feature/2.5.0-g05-strict-livekit-adr`.
- **PR title:** `docs(security): prove the strict LiveKit credential boundary`.
- **Depends on:** G04; operationally, green G04 merge envelope.
- **Objective:** Executable-prove strict same-token invalidation within the approved architecture; if evidence implies provider/topology/cost/fork/credential/goal-shape change, stop without green G05 and run the literal docs-only amendment/re-entry protocol.
- **Writable literal paths:** `docs/ADR_LIVEKIT_CREDENTIAL_BOUNDARY.md`; `scripts/lkv/run-strict-boundary-proof.mjs`; `apps/api/test/g05-livekit-boundary.test.js`; `docs/releases/2.5.0/amendments/G05-STRICT-LKV.json`; `docs/RELEASE_2.5.0_PLAN.md`; `docs/RELEASE_2.5.0_TEST_SPEC.md`.
- **Read-only literal paths:** `scripts/lkv/start-replay-topology.mjs`; `scripts/lkv/run-replay-scenario.mjs`; `scripts/lkv/partition-proxy.mjs`; `scripts/lkv/collect-replay-evidence.mjs`; `scripts/test/validate_release_250_plan.py`; `apps/api/src/server.js`; `apps/api/src/lib/config.js`; `docker-compose.yml`; `docker-compose.lkv.yml`.
- **Explicit non-goals:** No bounded replay, membership contract/schema, silent mechanism/topology/provider/cost/fork/credential/goal-shape change, green F11 for a blocked experiment, successor branch before amendment/restart, or Architect/Critic-only amendment without Planner.
- **Acceptance criteria:** If the approved mechanism denies every reconnect by the same issued token after revoke/leave/ban across restart/partition/race cases, normal G05 F7/F9/F11 may close. Otherwise freeze failed experiment evidence, emit no green G05 F11, close/delete branch and create docs-only `feature/2.5.0-g05-strict-lkv-amendment` from G04 green develop. It may write only `docs/releases/2.5.0/amendments/G05-STRICT-LKV.json`, canonical plan and spec; exact amendment head receives sequential Planner `APPROVE`, Architect `APPROVE`, Critic `APPROVE`, verifier, merge/remote deletion, regenerated plan/spec digests, trace/dependency/goal-ledger comparison, then G05 restarts from amended develop with the external auth-gate shape selected. No G06 or affected successor may start before restarted G05 is green.
- **Targeted verification:** planned test `apps/api/test/g05-livekit-boundary.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g05-livekit-boundary.test.js`; required job: `goal-g05`; case IDs `G05-A01`, `G05-A02`; fixtures: selected strict prototype, token theft, restart, partition, clock/race, mechanism-fits normal green, material provider/topology/cost/fork/credential/goal-shape change with frozen failure/no F11, literal amendment `docs/releases/2.5.0/amendments/G05-STRICT-LKV.json`, exact amendment command `python3 scripts/test/validate_release_250_plan.py --strict-lkv-amendment docs/releases/2.5.0/amendments/G05-STRICT-LKV.json --plan docs/RELEASE_2.5.0_PLAN.md --spec docs/RELEASE_2.5.0_TEST_SPEC.md`, job `goal-g05-strict-lkv-amendment`, cases `G05-AMEND-A01/A02`, sequential Planner/Architect/Critic objects, stale digest and restart from amended develop; highest proof **P3**; expected artifacts `ci-bundle.g05.json`, `approval-envelope.g05.json`, `merge-envelope.g05.json` only for a green mechanism, frozen blocked-experiment report, `ci-bundle.g05-strict-lkv-amendment.json`, `approval-envelope.g05-strict-lkv-amendment.json`, `merge-envelope.g05-strict-lkv-amendment.json`, regenerated plan/spec comparison, test report and OCI evidence digest.
- **Capability / rollback:** No public cutover; prototype flag false. Blocked experiment has no green F11. Approved amendment/restart is mandatory for material change; bounded replay remains rejected.
- **Review-loop exit:** Mechanism-fit path uses normal parallel implementation review/verifier and green F11. Material-change path closes the experiment without F11, completes sequential Planner→Architect→Critic amendment approval/verifier/merge, regenerates structural proof and restarts G05; any successor remains absent.

### G06 — unicode dependency authority

- **Branch:** `feature/2.5.0-g06-unicode-dependency-authority`.
- **PR title:** `docs(deps): choose the Unicode reaction dependency`.
- **Depends on:** G05; operationally, green G05 merge envelope.
- **Objective:** Compare at least two RGI data/renderer candidates and obtain explicit dependency authority before manifest mutation.
- **Writable literal paths:** `docs/ADR_UNICODE_REACTIONS.md`; `scripts/test/g06-unicode-candidates.test.mjs`.
- **Read-only literal paths:** `apps/api/package.json`; `apps/web/package.json`; `packages/shared/package.json`; `docs/RELEASE_2.6.0_PLAN.md`.
- **Explicit non-goals:** No package.json/lockfile change, reaction schema/API/UI or implicit dependency authorization.
- **Acceptance criteria:** ADR records candidates, license/attribution, maintenance/update cadence, runtime/bundle risk, Unicode version and named authority; lack of authority BLOCKS G07.
- **Targeted verification:** planned test `scripts/test/g06-unicode-candidates.test.mjs`; exact command: `node --test scripts/test/g06-unicode-candidates.test.mjs`; required job: `goal-g06`; case IDs `G06-A01`, `G06-A02`; fixtures: two candidate metadata/license fixtures and maintenance snapshots; highest proof **P1**; expected artifacts `ci-bundle.g06.json`, `approval-envelope.g06.json`, `merge-envelope.g06.json`, test report and OCI evidence digest.
- **Capability / rollback:** Documentation revert only; no dependency or capability exists.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G07 — unicode conformance adapter

- **Branch:** `feature/2.5.0-g07-unicode-conformance-adapter`.
- **PR title:** `build(shared): pin the authorized emoji conformance adapter`.
- **Depends on:** G06; operationally, green G06 merge envelope.
- **Objective:** Pin only the authorized dependency/data and expose one shared validation corpus/adapter.
- **Writable literal paths:** `package.json`; `package-lock.json`; `packages/shared/package.json`; `packages/shared/src/emoji.js`; `packages/shared/src/emoji.d.ts`; `packages/shared/src/emoji.mjs`; `packages/shared/test/g07-emoji-conformance.test.js`.
- **Read-only literal paths:** `docs/ADR_UNICODE_REACTIONS.md`; `packages/shared/src/validation.js`; `packages/shared/src/validation.d.ts`.
- **Explicit non-goals:** No reaction persistence/API/UI, custom emoji or package not named by G06 authority.
- **Acceptance criteria:** Clean install is reproducible; CJS/ESM/types agree; frozen corpus accepts supported RGI and rejects malformed/unsupported sequences with recorded data/license checksum.
- **Targeted verification:** planned test `packages/shared/test/g07-emoji-conformance.test.js`; exact command: `node --test packages/shared/test/g07-emoji-conformance.test.js`; required job: `goal-g07`; case IDs `G07-A01`, `G07-A02`; fixtures: ZWJ, tones, flags, VS15/16, keycaps, malformed and unsupported-version corpus; highest proof **P1**; expected artifacts `ci-bundle.g07.json`, `approval-envelope.g07.json`, `merge-envelope.g07.json`, test report and OCI evidence digest.
- **Capability / rollback:** No reactions capability; dependency can be reverted only before G67 consumers.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G08 — coverage infrastructure

- **Branch:** `feature/2.5.0-g08-coverage-infrastructure`.
- **PR title:** `test: enforce measured coverage gates`.
- **Depends on:** G07; operationally, green G07 merge envelope.
- **Objective:** Add baseline/non-regression and changed-business/security branch coverage gates without conflating DOM or architecture tooling.
- **Writable literal paths:** `config/coverage/release-250-thresholds.json`; `scripts/coverage/check-release-250-coverage.mjs`; `package.json`; `apps/api/package.json`; `apps/web/package.json`; `packages/shared/package.json`; `.github/workflows/ci.yml`; `scripts/test/g08-coverage-gate.test.mjs`.
- **Read-only literal paths:** `scripts/ci/run-actionlint.sh`; `config/tool-locks/actionlint-v1.7.12.json`.
- **Explicit non-goals:** No rendered-DOM runner, import-boundary rules or product refactor; no edit to the G01-owned actionlint wrapper/tool lock.
- **Acceptance criteria:** Measured baseline artifact exists; total cannot regress; changed business code ≥90% line/85% branch; named auth/permissions/cursor/idempotency/media paths require 100% branch and a seeded violation fails CI.
- **Targeted verification:** planned test `scripts/test/g08-coverage-gate.test.mjs`; exact command: `node --test scripts/test/g08-coverage-gate.test.mjs && scripts/ci/run-actionlint.sh .github/workflows/ci.yml`; required job: `goal-g08`; case IDs `G08-A01`, `G08-A02`; fixtures: baseline report and intentionally under-covered fixture; highest proof **P2**; expected artifacts `ci-bundle.g08.json`, `approval-envelope.g08.json`, `merge-envelope.g08.json`, test report and OCI evidence digest.
- **Capability / rollback:** Gate rollback requires plan amendment because every later code goal depends on it.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G09 — rendered dom a11y runner

- **Branch:** `feature/2.5.0-g09-rendered-dom-a11y-runner`.
- **PR title:** `test(web): add rendered DOM and accessibility gates`.
- **Depends on:** G08; operationally, green G08 merge envelope.
- **Objective:** Introduce a real Svelte DOM/component/a11y runner and CI job independent of source-regex tests.
- **Writable literal paths:** `apps/web/test/setup/dom-runtime.js`; `apps/web/test/setup/render-svelte.js`; `apps/web/test/setup/a11y-assertions.js`; `apps/web/test/g09-dom-runner.test.js`; `apps/web/package.json`; `package.json`; `.github/workflows/ci.yml`.
- **Read-only literal paths:** `apps/web/playwright.config.ts`; `apps/web/e2e/helpers.ts`; `apps/web/test/v2-ui-contract.test.js`.
- **Explicit non-goals:** No application UI change, architecture gate or screenshot commit.
- **Acceptance criteria:** Fixture proves focus, keyboard, ARIA, live-region and cleanup assertions; source-regex-only fixture is rejected; report is attached to exact head.
- **Targeted verification:** planned test `apps/web/test/g09-dom-runner.test.js`; exact command: `node --test apps/web/test/g09-dom-runner.test.js`; required job: `goal-g09`; case IDs `G09-A01`, `G09-A02`; fixtures: focus trap, keyboard, screen-reader name and intentionally invalid ARIA component; highest proof **P2**; expected artifacts `ci-bundle.g09.json`, `approval-envelope.g09.json`, `merge-envelope.g09.json`, test report and OCI evidence digest.
- **Capability / rollback:** Testing-only; no capability change.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G10 — ownership architecture gate

- **Branch:** `feature/2.5.0-g10-ownership-architecture-gate`.
- **PR title:** `refactor(api): publish and enforce domain ownership`.
- **Depends on:** G09; operationally, green G09 merge envelope.
- **Objective:** Publish the ownership/worker/capability matrix and enforce current real seams without creating empty future-domain abstractions.
- **Writable literal paths:** `docs/ARCHITECTURE_2.5.md`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/package.json`; `apps/api/test/g10-architecture-boundaries.test.js`; `scripts/import-boundary.mjs`; `scripts/check-api-sources.mjs`; `config/import-boundaries.v1.json`.
- **Read-only literal paths:** `apps/api/src/lib/db.js`; `packages/shared/src/validation.js`; `packages/shared/src/validation.d.ts`; `packages/shared/src/realtime.js`; `packages/shared/src/realtime.d.ts`; `packages/shared/package.json`.
- **Explicit non-goals:** No speculative messaging/membership/notification/media modules, schema or user-visible behavior.
- **Acceptance criteria:** Forbidden shared-secret/DB-model imports, direct foreign-table writes and API-listener worker timers fail; current behavior characterization stays green.
- **Targeted verification:** planned test `apps/api/test/g10-architecture-boundaries.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g10-architecture-boundaries.test.js`; required job: `goal-g10`; case IDs `G10-A01`, `G10-A02`; fixtures: forbidden-import/write/timer fixtures and current server composition graph; highest proof **P2**; expected artifacts `ci-bundle.g10.json`, `approval-envelope.g10.json`, `merge-envelope.g10.json`, test report and OCI evidence digest.
- **Capability / rollback:** Revert only before consumer goals; capabilities unchanged false.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G11 — immutable runtime image publication

- **Branch:** `feature/2.5.0-g11-immutable-runtime-image-publication`.
- **PR title:** `ci: publish immutable runtime images and provenance`.
- **Depends on:** G10; operationally, green G10 merge envelope.
- **Objective:** Build and publish API/Web/worker runtime images once per commit with SBOM and provenance, consume identical immutable digests across two non-production environments, and prove deployment hosts pull rather than build without changing the G03 evidence archive.
- **Writable literal paths:** `Dockerfile`; `.github/workflows/ci.yml`; `docker-compose.yml`; `docker-compose.ci.yml`; `config/oci/runtime-packages.v1.json`; `scripts/oci/build-publish.mjs`; `scripts/oci/verify-runtime-provenance.mjs`; `docs/operations/OCI_RUNTIME_PUBLICATION.md`; `scripts/test/g11-runtime-image-publication.test.mjs`.
- **Read-only literal paths:** `scripts/ci/run-actionlint.sh`; `config/tool-locks/actionlint-v1.7.12.json`; `config/evidence/release-evidence-archive.v1.json`; `package.json`; `apps/api/package.json`; `apps/web/package.json`.
- **Explicit non-goals:** No use/change of evidence package `ghcr.io/dazegg/voiceroom-release-evidence`, its archive contract/ledger/media types, evidence import/regeneration, production deploy, repository environment/secret mutation, registry vendor change or feature implementation; no edit to G01-owned actionlint wrapper/tool lock.
- **Acceptance criteria:** API, Web and worker publish separately as `ghcr.io/dazegg/voiceroom-api`, `ghcr.io/dazegg/voiceroom-web` and `ghcr.io/dazegg/voiceroom-worker`, built once with SBOM/provenance; two non-production environments consume identical immutable digests; deployment host has no build; missing/tampered image/SBOM/provenance fails. None shares the G03 evidence package, artifact type, ledger, annotations or retention role.
- **Targeted verification:** planned test `scripts/test/g11-runtime-image-publication.test.mjs`; exact command: `node --test scripts/test/g11-runtime-image-publication.test.mjs && scripts/ci/run-actionlint.sh .github/workflows/ci.yml`; required job: `goal-g11-runtime-images`; case IDs `G11-A01`, `G11-A02`; fixtures: two non-production runtime environments, API/Web/worker immutable digests, tampered digest, missing SBOM/provenance and attempted deployment-host build; highest proof **P3**; expected artifacts `ci-bundle.g11.json`, `approval-envelope.g11.json`, `merge-envelope.g11.json`, runtime provenance report and OCI evidence digest.
- **Capability / rollback:** Rollback selects previous recorded digests; never rebuilds them.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G12 — release deploy boundary

- **Branch:** `feature/2.5.0-g12-release-deploy-boundary`.
- **PR title:** `ci(release): decouple publication from production promotion`.
- **Depends on:** G11; operationally, green G11 merge envelope.
- **Objective:** Remove every ordinary/release production side effect and install a manual optional-promotion boundary that is nonblocking-disabled for current absent policy, possible repository/org secret scope, arbitrary ref or workflow substitution, and ready only from the exact verified v2.5.0 tag/workflow/policy source.
- **Writable literal paths:** `.github/workflows/ci.yml`; `.github/workflows/promote-production-digests.yml`; `docs/operations/PRODUCTION_DIGEST_PROMOTION.md`; `scripts/deploy/check-production-environment.mjs`; `scripts/deploy/promote-production-digests.mjs`; `scripts/deploy/revalidate-approved-promotion.mjs`; `config/deploy/production-environment-policy.v1.json`; `scripts/test/g12-release-deploy-boundary.test.mjs`.
- **Read-only literal paths:** `scripts/ci/run-actionlint.sh`; `config/tool-locks/actionlint-v1.7.12.json`; `config/oci/runtime-packages.v1.json`; `scripts/oci/verify-runtime-provenance.mjs`; `docs/GIT_FLOW.md`.
- **Explicit non-goals:** No production promotion, migration, endpoint, credential read/use, secret deletion/inspection, environment/policy/settings mutation or claim G12 supplies external protection. Possible repository/org production-secret existence is not a publication blocker after legacy workflow references are removed; no edit to G01 actionlint wrapper/tool lock.
- **Acceptance criteria:** Hostile PR/develop/main/tag/release/backmerge fixtures prove zero production endpoint, SSH, credential, migration, deploy, environment-job or deployment-host build calls under every authority and no ordinary/release workflow retains a production-secret expression. The manual workflow has only `workflow_dispatch`, top-level permissions `{}`, and credentialless `promotion-preflight` names no environment, receives no production/repository/org secret, OIDC token or host access, and uses exactly `actions: read`, `contents: read`, `deployments: read`, `packages: read`, all others including `id-token: none`. Current zero-environment/`production`-404, pre-tag G12/G93/RC state, a possible/detected repository/org production-secret metadata name or any secret-scope/policy/authority/ref/workflow/app mismatch emits `PROMOTION_DISABLED_EXTERNAL_AUTHORITY`; no environment job is scheduled, nothing is read/used/contacted, and publication remains eligible after legacy references are removed. A real future ready snapshot exists only after the annotated `v2.5.0` tag is created and verified, and binds repository ID/owner/name, dispatch ref `refs/tags/v2.5.0`, annotated tag-object SHA, peeled commit equal to verified main release merge, exact path `.github/workflows/promote-production-digests.yml`, its Git blob SHA/reusable-workflow digest from that tag, exact `github.workflow_ref=dazeGG/VoiceRoom/.github/workflows/promote-production-digests.yml@refs/tags/v2.5.0`, matching `github.workflow_sha`, approved immutable API/Web/worker digests, environment `production`, `protected_branches=false`, `custom_branch_policies=true`, the sole selected exact tag rule `v2.5.0`, required reviewer actor IDs, `prevent_self_review=true`, `can_admins_bypass=false`, and separately authorized dispatcher actor ID distinct from required approver as policy requires. Only then may `PROMOTION_READY_EXTERNAL_AUTHORITY` conditionally schedule a job statically bound to `production` with exactly `contents: read`, `packages: read`, `deployments: write`, all others including `id-token: none`; actual approver/object is captured after GitHub approval and before environment credentials. Arbitrary branch/tag/ref, lightweight/moved/wrong tag, modified workflow, permission escalation or policy drift is disabled/nonblocking. A committed repository/org production-secret reference or runtime read/use is a hard failure. G12/G93/pre-tag RC test only a synthetic ready routing fixture; no live ready authority, environment mutation or promotion occurs in this plan. After a future environment approval, credentialless policy revalidation must produce exact `post-approval-policy-envelope.json`; only an exact match permits the immediately following sole credential-consumer step, with no intervening step/wait/global credential expression. Drift or unavailable facts disable it without reading a secret.
- **Targeted verification:** planned test `scripts/test/g12-release-deploy-boundary.test.mjs`; exact command: `node --test scripts/test/g12-release-deploy-boundary.test.mjs && scripts/ci/run-actionlint.sh .github/workflows/ci.yml .github/workflows/promote-production-digests.yml`; required job: `goal-g12-deploy-boundary`; case IDs `G12-A01`, `G12-A02`; fixtures: zero-environment/production-404, hostile ordinary/release events, possible/detected repository/org secret and scope mismatch, credential/endpoint/job/OIDC spies, absent/mismatched reviewer policy, branch/default-branch/arbitrary tag dispatch, lightweight/moved/wrong-version tag, annotated-tag-object/peeled-SHA mismatch, wrong github.sha/workflow_ref/workflow_sha/blob/reusable digest, feature-branch workflow substitution, Protected-branches rule on unprotected repo, wildcard/branch deployment rule, wrong selected tag, prevent-self-review off, admin bypass on, unauthorized dispatcher, permission escalation, repository/org secret metadata collision versus committed expression/read/use, mutable app digest, exact synthetic v2.5.0 ready snapshot and post-approval actual approver; highest proof **P3**; expected artifacts `ci-bundle.g12.json`, `approval-envelope.g12.json`, `merge-envelope.g12.json`, disabled/trusted-source/policy-snapshot reports, test report and OCI evidence digest. Additional fixtures cover policy drift after approval, missing revalidation field, credential expression before revalidation, intervening step/wait/global environment, wrong deployment/approval actor IDs and exact immediate credential-step adjacency.
- **Capability / rollback:** Ordinary release publication is production-side-effect-free and does not depend on promotion readiness. Current optional promotion state is `PROMOTION_DISABLED_EXTERNAL_AUTHORITY`; reverting the boundary is forbidden. Any future readiness/promotion is a separate external-authority action, not this release execution.
- **Review-loop exit:** immutable F7 CI/test bundle proves ordinary-event zero calls and disabled external-authority path, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9; F11 proves the landed `develop` workflow remains publication-safe before G13.

### G13 — runtime config edge

- **Branch:** `feature/2.5.0-g13-runtime-config-edge`.
- **PR title:** `feat(platform): add safe runtime configuration`.
- **Depends on:** G12; operationally, green G12 merge envelope.
- **Objective:** Move safe public environment values to versioned startup runtime config so one Web digest works across environments.
- **Writable literal paths:** `packages/shared/src/runtime-config.js`; `packages/shared/src/runtime-config.d.ts`; `packages/shared/package.json`; `apps/web/src/lib/platform/runtime-config.ts`; `Caddyfile`; `Dockerfile`; `apps/web/test/g13-runtime-config.test.js`.
- **Read-only literal paths:** `docker-compose.yml`; `apps/web/src/routes/+page.svelte`; `apps/web/src/app.html`.
- **Explicit non-goals:** No capabilities, secrets, feature code or environment-specific rebuild.
- **Acceptance criteria:** The test launches the real production-equivalent Web/Caddy edge twice from one immutable Web digest, serves two different `runtime-config.json` documents over HTTP and proves each origin/LiveKit URL is consumed without rebuild. Real HTTP 404, timeout and malformed/secret payloads fail to documented safe legacy defaults; contract v1 validates and the served/client bundle secret scan is empty.
- **Targeted verification:** planned test `apps/web/test/g13-runtime-config.test.js`; exact command: `node --test apps/web/test/g13-runtime-config.test.js`; required job: `goal-g13`; case IDs `G13-A01`, `G13-A02`; fixtures: two real HTTP Caddy origins with distinct LiveKit URLs from the same Web digest, 404, timeout, malformed JSON and secret payload; highest proof **P3**; expected artifacts `ci-bundle.g13.json`, `approval-envelope.g13.json`, `merge-envelope.g13.json`, test report and OCI evidence digest.
- **Capability / rollback:** Edge config remains available through API rollback; no public feature enabled.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G14 — effective capability readiness

- **Branch:** `feature/2.5.0-g14-effective-capability-readiness`.
- **PR title:** `feat(platform): add fail-closed capabilities and provenance`.
- **Depends on:** G13; operationally, green G13 merge envelope.
- **Objective:** Materialize and validate the canonical `voice-room.capabilities/v1` nine-key/public and private-operator DAG, then compute fail-closed effective readiness from that exact manifest.
- **Writable literal paths:** `packages/shared/src/capabilities.js`; `packages/shared/src/capabilities.d.ts`; `packages/shared/package.json`; `apps/api/src/platform/capabilities.js`; `apps/api/src/platform/readiness.js`; `apps/api/src/platform/capability-routes.js`; `apps/api/src/lib/metrics.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/web/src/lib/api/capabilities.ts`; `apps/web/src/lib/platform/capability-state.svelte.ts`; `apps/api/test/g14-capability-readiness.test.js`; `apps/web/test/g14-capability-client.test.js`; `docs/operations/CAPABILITY_READINESS.md`; `config/capability-dag.v1.json`.
- **Read-only literal paths:** `docs/RELEASE_2.5.0_PLAN.md`; `apps/api/src/lib/config.js`; `docker-compose.yml`.
- **Explicit non-goals:** No feature key true, operator flag disclosure or worker implementation.
- **Acceptance criteria:** Manifest has exactly nine public keys and the enumerated private/internal nodes; unknown/missing=false; health reports manifest digest/version/SHA/schema/digests; every prerequisite and replica-vector mismatch makes the affected public key false; operator names/values never serialize.
- **Targeted verification:** planned test `apps/api/test/g14-capability-readiness.test.js`; exact command: `CAPABILITY_DAG_PATH=config/capability-dag.v1.json TEST_DATABASE_URL=postgres://... node --test apps/api/test/g14-capability-readiness.test.js`; required job: `goal-g14`; case IDs `G14-A01`, `G14-A02`; fixtures: exact manifest digest, mixed-replica, dirty-schema, missing-worker, stale-config, unknown-key, missing-edge and cycle fixtures; highest proof **P3**; expected artifacts `ci-bundle.g14.json`, `approval-envelope.g14.json`, `merge-envelope.g14.json`, test report and OCI evidence digest.
- **Capability / rollback:** All public desired flags false and operator writes/workers off by default.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G15 — locked predeploy migrations

- **Branch:** `feature/2.5.0-g15-locked-predeploy-migrations`.
- **PR title:** `build(api): add fenced predeploy migrations`.
- **Depends on:** G14; operationally, green G14 merge envelope.
- **Objective:** Move production migration to explicit locked predeploy with lock timeout/loss, dirty-state and N-1 rehearsal.
- **Writable literal paths:** `apps/api/src/lib/migrate.js`; `apps/api/src/scripts/migrate.js`; `apps/api/test/g15-migration-control.test.js`; `.github/workflows/ci.yml`; `docker-compose.yml`; `docker-compose.ci.yml`; `docs/operations/PREDEPLOY_MIGRATIONS.md`.
- **Read-only literal paths:** `apps/api/src/lib/db.js`; `apps/api/src/lib/config.js`; `docs/GIT_FLOW.md`.
- **Explicit non-goals:** No product schema, destructive down or API listener auto-migration in production.
- **Acceptance criteria:** Concurrent runners serialize; `lock_timeout=5s`; forced lock loss aborts before advertise/deploy; failure/dirty state blocks listener rollout; v2.4.2 starts against unchanged schema.
- **Targeted verification:** planned test `apps/api/test/g15-migration-control.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g15-migration-control.test.js`; required job: `goal-g15`; case IDs `G15-A01`, `G15-A02`; fixtures: concurrent runners, 5s blocker, lock-loss, interrupted/dirty/no-op/fresh fixtures; highest proof **P3**; expected artifacts `ci-bundle.g15.json`, `approval-envelope.g15.json`, `merge-envelope.g15.json`, test report and OCI evidence digest.
- **Capability / rollback:** Application rollback uses additive schema; production down forbidden.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G16 — platform class contract

- **Branch:** `feature/2.5.0-g16-platform-class-contract`.
- **PR title:** `feat(shared): define normalized platform classification`.
- **Depends on:** G15; operationally, green G15 merge envelope.
- **Objective:** Define the deterministic desktop/mobile/unknown classifier and cross-runtime DTO without persistence or product gating.
- **Writable literal paths:** `packages/shared/src/platform-class.js`; `packages/shared/src/platform-class.d.ts`; `packages/shared/package.json`; `packages/shared/test/g16-platform-class-contract.test.js`.
- **Read-only literal paths:** `packages/shared/src/validation.js`; `packages/shared/src/validation.d.ts`; `apps/web/src/lib/api/desktop.ts`; `apps/web/src/service-worker.ts`.
- **Explicit non-goals:** No migration, push subscription write, API/Web integration, root UI gate, fingerprinting or push cutover.
- **Acceptance criteria:** iOS/Android/iPadOS classify blocked; Windows/macOS/Linux and VoiceRoomDesktop classify allowed even narrow; unknown follows documented fail-open support; CJS/ESM/types agree and no raw-UA field exists.
- **Targeted verification:** planned test `packages/shared/test/g16-platform-class-contract.test.js`; exact command: `node --test packages/shared/test/g16-platform-class-contract.test.js`; required job: `goal-g16`; case IDs `G16-A01`, `G16-A02`; fixtures: UA-CH/mobile, iPad desktop-UA, narrow desktop, Desktop bridge, unknown and malformed corpus; highest proof **P1**; expected artifacts `ci-bundle.g16.json`, `approval-envelope.g16.json`, `merge-envelope.g16.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.desktopBoundary` remains false/unconsumed; the nine-key public capability contract is unchanged.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G17 — platform class persistence integration

- **Branch:** `feature/2.5.0-g17-platform-class-persistence-integration`.
- **PR title:** `feat(platform): persist normalized push platform class`.
- **Depends on:** G16; operationally, green G16 merge envelope.
- **Objective:** Add additive normalized push-platform persistence, bounded reclassification and API/Web adapters that consume the G16 classifier.
- **Writable literal paths:** `apps/api/src/migrations/20260718120000_add_push_subscription_platform_class.js`; `apps/api/src/lib/push-store.js`; `apps/web/src/lib/platform/platform-class.ts`; `apps/api/test/g17-platform-class-persistence.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260711130000_create_push_subscriptions.js`; `packages/shared/src/platform-class.js`; `packages/shared/src/platform-class.d.ts`; `apps/web/src/service-worker.ts`.
- **Explicit non-goals:** No root UI gate, mobile product, raw-UA retention, fingerprinting, push dispatch cutover or public capability key.
- **Acceptance criteria:** Fresh, v2.4.2 upgrade, repeated no-op, 10k-row bounded reclassification, ≤5s lock and application rollback all pass; stored enum contains no raw UA and API/Web results equal the G16 corpus.
- **Targeted verification:** planned test `apps/api/test/g17-platform-class-persistence.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g17-platform-class-persistence.test.js`; required job: `goal-g17`; case IDs `G17-A01`, `G17-A02`; fixtures: fresh/upgrade/no-op/lock-loss/application-rollback DB, 10k mixed subscriptions and G16 corpus; highest proof **P3**; expected artifacts `ci-bundle.g17.json`, `approval-envelope.g17.json`, `merge-envelope.g17.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.desktopBoundary` remains false; application rollback ignores the additive enum while server/SW suppression stays fail-closed.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G18 — desktop root boundary

- **Branch:** `feature/2.5.0-g18-desktop-root-boundary`.
- **PR title:** `feat(web): enforce the desktop-only root boundary`.
- **Depends on:** G17; operationally, green G17 merge envelope.
- **Objective:** Gate all entry routes before child mount and suppress session/WS/LiveKit/audio/media/push-init plus SW notification on blocked class.
- **Writable literal paths:** `apps/web/src/routes/+layout.svelte`; `apps/web/src/lib/features/shared-content/start-features.ts`; `apps/web/src/lib/features/auth/session.svelte.ts`; `apps/web/src/lib/features/home/model/push-notifications.svelte.ts`; `apps/web/src/service-worker.ts`; `apps/api/src/lib/push-service.js`; `apps/api/src/lib/push-store.js`; `apps/api/src/server.js`; `apps/web/e2e/g18-desktop-root-boundary.spec.ts`.
- **Read-only literal paths:** `apps/web/src/routes/+page.svelte`; `apps/web/src/routes/login/+page.svelte`; `apps/web/src/routes/register/+page.svelte`; `apps/web/src/routes/r/[roomId]/+page.svelte`; `apps/web/src/lib/platform/platform-class.ts`; `packages/shared/src/platform-class.js`; `apps/web/src/lib/api/desktop.ts`.
- **Explicit non-goals:** No responsive mobile app/PWA or physical manual certification.
- **Acceptance criteria:** Blocked `/`, login/register and room routes show one accessible install boundary at ≥320px and issue zero prohibited calls; already-registered mobile SW displays zero notification; desktop flows unchanged.
- **Targeted verification:** planned test `apps/web/e2e/g18-desktop-root-boundary.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g18-desktop-root-boundary.spec.ts`; required job: `goal-g18`; case IDs `G18-A01`, `G18-A02`; fixtures: blocked route matrix, network instrumentation, registered SW/subscription, narrow desktop; highest proof **P3**; expected artifacts `ci-bundle.g18.json`, `approval-envelope.g18.json`, `merge-envelope.g18.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.desktopBoundary=false` until proof; server/SW suppression remains defense-in-depth.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G19 — desktop physical rc matrix

- **Branch:** `feature/2.5.0-g19-desktop-physical-rc-matrix`.
- **PR title:** `test(release): establish the physical desktop support matrix`.
- **Depends on:** G18; operationally, green G18 merge envelope.
- **Objective:** Define and execute reproducible manual/physical RC evidence for iOS/Android/iPadOS, desktop browsers and minimum VoiceRoomDesktop.
- **Writable literal paths:** `docs/operations/DESKTOP_SUPPORT_MATRIX.md`; `scripts/evidence/g19-physical-matrix.schema.json`; `docs/releases/2.5.0/evidence/index.json`; `scripts/test/g19-physical-matrix.test.mjs`.
- **Read-only literal paths:** `docs/RELEASE_2.5.0_PLAN.md`; `apps/web/src/lib/api/desktop.ts`; `apps/web/src/lib/platform/platform-class.ts`; `apps/web/src/routes/+layout.svelte`.
- **Explicit non-goals:** No product code, device purchase claim or simulated-only substitution for physical RC.
- **Acceptance criteria:** Signed checklist records OS/browser/Desktop versions, capture time, blocked/allowed result, zero side effects, focus/name/layout and independently stored artifact ID for every source-required platform. The verifier resolves each artifact ID, validates device/browser/app identity metadata and capture timestamp, rejects duplicate/reused/tampered identities, and requires a reviewer identity distinct from the implementer; missing/stale/self-attested-only row blocks checkpoint/release.
- **Targeted verification:** planned test `scripts/test/g19-physical-matrix.test.mjs`; exact command: `node --test scripts/test/g19-physical-matrix.test.mjs`; required job: `goal-g19`; case IDs `G19-A01`, `G19-A02`; fixtures: independently captured iOS Safari, Android Chrome, iPadOS, desktop Chrome/Firefox/Safari and minimum Desktop artifacts, duplicate identity, tampered metadata, implementer-equals-reviewer and stale capture; highest proof **P4**; expected artifacts `ci-bundle.g19.json`, `approval-envelope.g19.json`, `merge-envelope.g19.json`, test report and OCI evidence digest.
- **Capability / rollback:** No capability change; stale device evidence expires at RC and must rerun.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G20 — opaque cursor codec

- **Branch:** `feature/2.5.0-g20-opaque-cursor-codec`.
- **PR title:** `feat(api): add the purpose-bound opaque cursor codec`.
- **Depends on:** G19; operationally, green G19 merge envelope.
- **Objective:** Implement one server-only HMAC codec with rotation/expiry/purpose/context binding reused by all cursor domains; Web remains opaque.
- **Writable literal paths:** `apps/api/src/platform/cursor-codec.js`; `apps/api/test/g20-cursor-codec.test.js`; `packages/shared/src/validation.js`; `packages/shared/src/validation.d.ts`; `packages/shared/test/validation.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/room-store.js`; `apps/api/src/lib/friend-store.js`; `apps/api/src/lib/config.js`.
- **Explicit non-goals:** No database query, route, Web decode, feature cursor or HMAC secret in shared package.
- **Acceptance criteria:** Round-trip preserves exact microsecond+ID; tamper/expired/wrong purpose/context/key fail 400 without oracle detail; current+previous key rotation passes.
- **Targeted verification:** planned test `apps/api/test/g20-cursor-codec.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g20-cursor-codec.test.js`; required job: `goal-g20`; case IDs `G20-A01`, `G20-A02`; fixtures: same-microsecond tuples, tamper corpus, current/previous keys, cross-context purpose; highest proof **P2**; expected artifacts `ci-bundle.g20.json`, `approval-envelope.g20.json`, `merge-envelope.g20.json`, test report and OCI evidence digest.
- **Capability / rollback:** No public capability; codec unused until consumers.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G21 — history read contracts

- **Branch:** `feature/2.5.0-g21-history-read-contracts`.
- **PR title:** `feat(shared): define history and read contracts`.
- **Depends on:** G20; operationally, green G20 merge envelope.
- **Objective:** Publish latest/before/after/around envelopes and exact 2.5 read-cursor DTOs with legacy fallback.
- **Writable literal paths:** `packages/shared/src/messaging-history.js`; `packages/shared/src/messaging-history.d.ts`; `packages/shared/package.json`; `packages/shared/test/g21-history-contract.test.js`.
- **Read-only literal paths:** `packages/shared/src/realtime.js`; `packages/shared/src/realtime.d.ts`; `apps/web/src/lib/api/rooms.ts`; `apps/web/src/lib/api/dm.ts`; `apps/api/src/platform/cursor-codec.js`.
- **Explicit non-goals:** No reply/idempotency/outbox contracts, schema, route or cursor decode in Web.
- **Acceptance criteria:** CJS/ESM/types agree; limits/defaults and opaque cursors validate; unknown version falls back; read cursor can only be obtained from message DTO.
- **Targeted verification:** planned test `packages/shared/test/g21-history-contract.test.js`; exact command: `node --test packages/shared/test/g21-history-contract.test.js`; required job: `goal-g21`; case IDs `G21-A01`, `G21-A02`; fixtures: legacy/current/future envelopes, invalid limits and opaque cursor corpus; highest proof **P1**; expected artifacts `ci-bundle.g21.json`, `approval-envelope.g21.json`, `merge-envelope.g21.json`, test report and OCI evidence digest.
- **Capability / rollback:** All history/read capabilities false; legacy adapters remain.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G22 — reply send outbox contracts

- **Branch:** `feature/2.5.0-g22-reply-send-outbox-contracts`.
- **PR title:** `feat(shared): define reply idempotency and message-delivery contracts`.
- **Depends on:** G21; operationally, green G21 merge envelope.
- **Objective:** Publish additive reply preview, idempotent send and logical message-delivery event contracts separately from notification identities.
- **Writable literal paths:** `packages/shared/src/messaging-send.js`; `packages/shared/src/messaging-send.d.ts`; `packages/shared/package.json`; `packages/shared/test/g22-send-contract.test.js`.
- **Read-only literal paths:** `apps/api/src/server.js`; `apps/api/src/lib/friend-store.js`; `packages/shared/src/realtime.js`; `packages/shared/src/realtime.d.ts`.
- **Explicit non-goals:** No schema/API/UI, recursive preview tree, notification outbox or feature enablement.
- **Acceptance criteria:** Reply-to-reply DTO is allowed but preview is one non-recursive level; immutable pointer/system-card exclusion/guest-room keys and bounded idempotency validate.
- **Targeted verification:** planned test `packages/shared/test/g22-send-contract.test.js`; exact command: `node --test packages/shared/test/g22-send-contract.test.js`; required job: `goal-g22`; case IDs `G22-A01`, `G22-A02`; fixtures: account/guest room, DM, reply-to-reply, system card and idempotency fingerprint fixtures; highest proof **P1**; expected artifacts `ci-bundle.g22.json`, `approval-envelope.g22.json`, `merge-envelope.g22.json`, test report and OCI evidence digest.
- **Capability / rollback:** Capabilities false; old DTOs remain parseable.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G23 — messaging seam visibility

- **Branch:** `feature/2.5.0-g23-messaging-seam-visibility`.
- **PR title:** `refactor(api): establish messaging UoW and visibility seams`.
- **Depends on:** G22; operationally, green G22 merge envelope.
- **Objective:** Characterize current room/DM behavior and introduce just-in-time messaging service plus one visibility policy without feature behavior.
- **Writable literal paths:** `apps/api/src/domains/messaging/message-service.js`; `apps/api/src/domains/messaging/message-visibility-service.js`; `apps/api/src/domains/messaging/room-message-repository.js`; `apps/api/src/domains/messaging/direct-message-repository.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/src/lib/room-store.js`; `apps/api/src/lib/friend-store.js`; `apps/api/test/g23-messaging-seam.test.js`.
- **Read-only literal paths:** `docs/ARCHITECTURE_2.5.md`; `packages/shared/src/messaging-history.js`; `packages/shared/src/messaging-send.js`; `apps/api/src/lib/db.js`.
- **Explicit non-goals:** No new schema, route, reply/reaction/media rule or speculative other-domain module.
- **Acceptance criteria:** Existing room/DM send/read/edit/delete envelopes and authorization are unchanged; all future visibility consumers inject the same policy; architecture gate forbids duplicate policies.
- **Targeted verification:** planned test `apps/api/test/g23-messaging-seam.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g23-messaging-seam.test.js`; required job: `goal-g23`; case IDs `G23-A01`, `G23-A02`; fixtures: current HTTP/realtime characterization and forbidden second-policy fixture; highest proof **P2**; expected artifacts `ci-bundle.g23.json`, `approval-envelope.g23.json`, `merge-envelope.g23.json`, test report and OCI evidence digest.
- **Capability / rollback:** No capability; revert restores prior composition without data change.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G24 — history index schema

- **Branch:** `feature/2.5.0-g24-history-index-schema`.
- **PR title:** `feat(api): add additive history cursor indexes`.
- **Depends on:** G23; operationally, green G23 merge envelope.
- **Objective:** Add only measured tuple indexes/columns needed for room/DM cursor queries after EXPLAIN of existing indexes.
- **Writable literal paths:** `apps/api/src/migrations/20260718121000_add_message_history_cursor_indexes.js`; `apps/api/test/g24-history-schema.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260614144500_create_rooms_and_room_messages.js`; `apps/api/src/migrations/20260627120000_create_friends_and_direct_messages.js`; `apps/api/src/lib/migrate.js`.
- **Explicit non-goals:** No read-cursor schema, conversation_id without evidence, route/UI or destructive index removal.
- **Acceptance criteria:** Fresh/upgrade/no-op and v2.4.2 startup pass; blocking lock ≤5s; 500-room and 100k-DM fixtures use intended plan with no offset scan.
- **Targeted verification:** planned test `apps/api/test/g24-history-schema.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g24-history-schema.test.js`; required job: `goal-g24`; case IDs `G24-A01`, `G24-A02`; fixtures: 500 active room messages, 100k-message DM plus mixed threads, lock blocker; highest proof **P3**; expected artifacts `ci-bundle.g24.json`, `approval-envelope.g24.json`, `merge-envelope.g24.json`, test report and OCI evidence digest.
- **Capability / rollback:** `historyCursor=false`; additive indexes remain on rollback.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G25 — read cursor schema

- **Branch:** `feature/2.5.0-g25-read-cursor-schema`.
- **PR title:** `feat(api): add additive exact read cursor state`.
- **Depends on:** G24; operationally, green G24 merge envelope.
- **Objective:** Add exact room tuple/projection metadata and DM-compatible cursor support while retaining legacy fields/rows.
- **Writable literal paths:** `apps/api/src/migrations/20260718122000_add_message_read_cursors.js`; `apps/api/test/g25-read-schema.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260714120000_create_room_chat_reads.js`; `apps/api/src/migrations/20260627120000_create_friends_and_direct_messages.js`; `apps/api/src/lib/friend-store.js`; `apps/api/src/lib/migrate.js`.
- **Explicit non-goals:** No read API/Web reconciliation or claim that legacy reads are lossless.
- **Acceptance criteria:** Exact tuple and conservative projection coexist with `last_read_at`/DM `read_at`; fresh/upgrade/v2.4.2 startup pass; equal-microsecond ordering is representable.
- **Targeted verification:** planned test `apps/api/test/g25-read-schema.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g25-read-schema.test.js`; required job: `goal-g25`; case IDs `G25-A01`, `G25-A02`; fixtures: equal-microsecond clusters, legacy room/DM read rows and N-1 schema fixture; highest proof **P3**; expected artifacts `ci-bundle.g25.json`, `approval-envelope.g25.json`, `merge-envelope.g25.json`, test report and OCI evidence digest.
- **Capability / rollback:** `readCursor=false`; old fields retained; no destructive down.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G26 — room pagination api

- **Branch:** `feature/2.5.0-g26-room-pagination-api`.
- **PR title:** `feat(api): add room cursor pagination`.
- **Depends on:** G25; operationally, green G25 merge envelope.
- **Objective:** Implement room latest/before/after/around using platform codec and visibility policy.
- **Writable literal paths:** `apps/api/src/domains/messaging/room-history-repository.js`; `apps/api/src/domains/messaging/room-history-service.js`; `apps/api/src/domains/messaging/room-history-routes.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/src/lib/room-store.js`; `apps/api/test/g26-room-pagination.test.js`.
- **Read-only literal paths:** `apps/api/src/platform/cursor-codec.js`; `packages/shared/src/messaging-history.js`; `apps/api/src/migrations/20260718121000_add_message_history_cursor_indexes.js`.
- **Explicit non-goals:** No DM pagination, read mutation, Web UI, reply projection or search.
- **Acceptance criteria:** Limit default 50/max100; cursor scope/tamper enforced; concurrent same-time inserts/edit/delete/expiry produce exact no-gap/no-duplicate set; p95/p99 budgets deferred but query artifact emitted.
- **Targeted verification:** planned test `apps/api/test/g26-room-pagination.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g26-room-pagination.test.js`; required job: `goal-g26`; case IDs `G26-A01`, `G26-A02`; fixtures: 500-message room, same-microsecond inserts, delete/expiry/tamper/cross-room; highest proof **P3**; expected artifacts `ci-bundle.g26.json`, `approval-envelope.g26.json`, `merge-envelope.g26.json`, test report and OCI evidence digest.
- **Capability / rollback:** `historyCursor=false`; legacy no-cursor adapter remains.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G27 — dm pagination api

- **Branch:** `feature/2.5.0-g27-dm-pagination-api`.
- **PR title:** `feat(api): add direct-message cursor pagination`.
- **Depends on:** G26; operationally, green G26 merge envelope.
- **Objective:** Implement DM latest/before/after/around without GET read mutation.
- **Writable literal paths:** `apps/api/src/domains/messaging/dm-history-repository.js`; `apps/api/src/domains/messaging/dm-history-service.js`; `apps/api/src/domains/messaging/dm-history-routes.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/src/lib/friend-store.js`; `apps/api/test/g27-dm-pagination.test.js`.
- **Read-only literal paths:** `apps/api/src/platform/cursor-codec.js`; `packages/shared/src/messaging-history.js`; `apps/api/src/migrations/20260718121000_add_message_history_cursor_indexes.js`.
- **Explicit non-goals:** No room changes, read API, Web UI, DM mention or conversation_id without measured need.
- **Acceptance criteria:** Newest page ascends; limit50/max100; GET performs zero writes; cursor bound to participants; 100k thread pages exactly once under concurrent send/edit/delete.
- **Targeted verification:** planned test `apps/api/test/g27-dm-pagination.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g27-dm-pagination.test.js`; required job: `goal-g27`; case IDs `G27-A01`, `G27-A02`; fixtures: 100k DM thread, mixed conversations, unauthorized peer, same-time mutations; highest proof **P3**; expected artifacts `ci-bundle.g27.json`, `approval-envelope.g27.json`, `merge-envelope.g27.json`, test report and OCI evidence digest.
- **Capability / rollback:** `historyCursor=false`; legacy thread response retained.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G28 — room pagination web

- **Branch:** `feature/2.5.0-g28-room-pagination-web`.
- **PR title:** `feat(web): add anchored room history loading`.
- **Depends on:** G27; operationally, green G27 merge envelope.
- **Objective:** Consume opaque room pages with ≤2px prepend anchor, one older request, stale cancellation and realtime reconciliation.
- **Writable literal paths:** `apps/web/src/lib/api/rooms.ts`; `apps/web/src/lib/features/room/room-history.svelte.ts`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/e2e/g28-room-pagination.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/messaging-history.js`; `apps/web/src/lib/api/realtime.ts`; `apps/web/src/lib/platform/capability-state.svelte.ts`.
- **Explicit non-goals:** No DM UI, read cursor, replies, virtualization rewrite or mobile layout.
- **Acceptance criteria:** Initial latest/older/end/error work; anchor drift ≤2px; one in-flight older request; room switch cancels stale result; exact IDs converge with realtime.
- **Targeted verification:** planned test `apps/web/e2e/g28-room-pagination.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g28-room-pagination.spec.ts`; required job: `goal-g28`; case IDs `G28-A01`, `G28-A02`; fixtures: two contexts, delayed older response, room switch, realtime edit/delete; highest proof **P3**; expected artifacts `ci-bundle.g28.json`, `approval-envelope.g28.json`, `merge-envelope.g28.json`, test report and OCI evidence digest.
- **Capability / rollback:** UI shadowed behind false `historyCursor`; legacy component remains.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G29 — dm pagination web

- **Branch:** `feature/2.5.0-g29-dm-pagination-web`.
- **PR title:** `feat(web): add anchored direct-message history loading`.
- **Depends on:** G28; operationally, green G28 merge envelope.
- **Objective:** Consume opaque DM pages with newest-open, stable prepend, thread isolation and realtime dedupe.
- **Writable literal paths:** `apps/web/src/lib/api/dm.ts`; `apps/web/src/lib/features/home/model/friends.svelte.ts`; `apps/web/src/lib/features/home/components/lobby/DmView.svelte`; `apps/web/e2e/g29-dm-pagination.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/messaging-history.js`; `apps/web/src/lib/api/realtime.ts`; `apps/web/src/lib/platform/capability-state.svelte.ts`.
- **Explicit non-goals:** No room change, read cursor, replies, inbox or reactions.
- **Acceptance criteria:** Anchor drift ≤2px; one older request; stale thread response ignored; exact IDs converge under reconnect; legacy API fallback works.
- **Targeted verification:** planned test `apps/web/e2e/g29-dm-pagination.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g29-dm-pagination.spec.ts`; required job: `goal-g29`; case IDs `G29-A01`, `G29-A02`; fixtures: two DM threads, delayed response, reconnect/duplicate event and 100k seeded thread; highest proof **P3**; expected artifacts `ci-bundle.g29.json`, `approval-envelope.g29.json`, `merge-envelope.g29.json`, test report and OCI evidence digest.
- **Capability / rollback:** Flag false keeps legacy fetch; client never decodes cursor.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G30 — explicit read api

- **Branch:** `feature/2.5.0-g30-explicit-read-api`.
- **PR title:** `feat(api): add exact cursor-derived read updates`.
- **Depends on:** G29; operationally, green G29 merge envelope.
- **Objective:** Implement monotonic room/DM read APIs plus conservative legacy projection and disclose wall-clock legacy limitation.
- **Writable literal paths:** `apps/api/src/domains/messaging/message-read-repository.js`; `apps/api/src/domains/messaging/message-read-service.js`; `apps/api/src/domains/messaging/message-read-routes.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/src/realtime/account-events.js`; `apps/api/src/lib/room-store.js`; `apps/api/src/lib/friend-store.js`; `apps/api/test/g30-read-cursor.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260718122000_add_message_read_cursors.js`; `apps/api/src/platform/cursor-codec.js`; `packages/shared/src/messaging-history.js`.
- **Explicit non-goals:** No Web render trigger, no guarantee for actual v2.4.2 wall-clock reads and no GET side effect.
- **Acceptance criteria:** 2.5 cursor advances only visible tuple and never regresses; new GET writes zero; room projection is conservative; actual v2.4.2 room/DM reads may clear unrendered messages and roll-forward records but cannot reconstruct that set.
- **Targeted verification:** planned test `apps/api/test/g30-read-cursor.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g30-read-cursor.test.js`; required job: `goal-g30`; case IDs `G30-A01`, `G30-A02`; fixtures: PG-READ-001..009 legacy/equal-time/two-client fixtures from prior maximal spec; highest proof **P3**; expected artifacts `ci-bundle.g30.json`, `approval-envelope.g30.json`, `merge-envelope.g30.json`, test report and OCI evidence digest.
- **Capability / rollback:** `readCursor=false`; legacy adapters remain; limitation documented in API/runbook.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G31 — read reconciliation web

- **Branch:** `feature/2.5.0-g31-read-reconciliation-web`.
- **PR title:** `feat(web): reconcile explicit read state`.
- **Depends on:** G30; operationally, green G30 merge envelope.
- **Objective:** Advance read only after actual latest/realtime render, never on older/around load, and converge tabs/reconnect before enabling history/read.
- **Writable literal paths:** `apps/web/src/lib/shared/chat/read-reconciliation.svelte.ts`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/src/lib/features/home/components/lobby/DmView.svelte`; `apps/web/e2e/g31-read-reconciliation.spec.ts`.
- **Read-only literal paths:** `apps/web/src/lib/api/rooms.ts`; `apps/web/src/lib/api/dm.ts`; `apps/web/src/lib/api/capabilities.ts`; `apps/web/src/lib/platform/capability-state.svelte.ts`; `packages/shared/src/messaging-history.js`.
- **Explicit non-goals:** No inbox first-unread jump or attempt to repair old-client render history.
- **Acceptance criteria:** Two tabs converge to max rendered cursor; older/around alone performs zero read POST; newer unseen remains unread; legacy server fallback is explicit.
- **Targeted verification:** planned test `apps/web/e2e/g31-read-reconciliation.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g31-read-reconciliation.spec.ts`; required job: `goal-g31`; case IDs `G31-A01`, `G31-A02`; fixtures: two tabs, delayed render, older/around page, legacy API profile; highest proof **P3**; expected artifacts `ci-bundle.g31.json`, `approval-envelope.g31.json`, `merge-envelope.g31.json`, test report and OCI evidence digest.
- **Capability / rollback:** Enable `historyCursor/readCursor` only after staging; disable hides new UI but preserves exact state.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G32 — reply schema projector

- **Branch:** `feature/2.5.0-g32-reply-schema-projector`.
- **PR title:** `feat(api): add immutable reply pointers and projection`.
- **Depends on:** G31; operationally, green G31 merge envelope.
- **Objective:** Add nullable immutable reply pointers and non-recursive preview/tombstone projector using one visibility policy.
- **Writable literal paths:** `apps/api/src/migrations/20260718123000_add_message_replies.js`; `apps/api/src/domains/messaging/reply-projector.js`; `apps/api/src/domains/messaging/reply-repository.js`; `apps/api/test/g32-reply-schema.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260614144500_create_rooms_and_room_messages.js`; `apps/api/src/migrations/20260627120000_create_friends_and_direct_messages.js`; `packages/shared/src/messaging-send.js`; `apps/api/src/lib/migrate.js`.
- **Explicit non-goals:** No send route/Web UI/notification, recursive preview tree or hard FK purge cascade.
- **Acceptance criteria:** Reply-to-reply stores target pointer but preview contains only target summary; pointer cannot edit; system/invitation card invalid; purge yields terminal tombstone; N-1 starts.
- **Targeted verification:** planned test `apps/api/test/g32-reply-schema.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g32-reply-schema.test.js`; required job: `goal-g32`; case IDs `G32-A01`, `G32-A02`; fixtures: normal/reply/system-card/deleted/expired room and DM targets; highest proof **P3**; expected artifacts `ci-bundle.g32.json`, `approval-envelope.g32.json`, `merge-envelope.g32.json`, test report and OCI evidence digest.
- **Capability / rollback:** `replies=false`; nullable fields remain on rollback; old events omit preview.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G33 — reply api realtime

- **Branch:** `feature/2.5.0-g33-reply-api-realtime`.
- **PR title:** `feat(api): add room and DM reply send behavior`.
- **Depends on:** G32; operationally, green G32 merge envelope.
- **Objective:** Validate/create replies transactionally for registered and guest room send and registered DM, with non-disclosing failures and events.
- **Writable literal paths:** `apps/api/src/domains/messaging/message-service.js`; `apps/api/src/domains/messaging/message-routes.js`; `apps/api/src/domains/messaging/message-realtime-adapter.js`; `apps/api/src/app.js`; `apps/api/src/realtime/account-events.js`; `packages/shared/src/realtime.js`; `packages/shared/src/realtime.d.ts`; `packages/shared/package.json`; `apps/api/test/g33-reply-api.test.js`.
- **Read-only literal paths:** `apps/api/src/domains/messaging/reply-projector.js`; `apps/api/src/domains/messaging/reply-repository.js`; `apps/api/src/domains/messaging/room-message-repository.js`; `apps/api/src/domains/messaging/direct-message-repository.js`; `apps/api/src/lib/room-store.js`; `apps/api/src/lib/friend-store.js`.
- **Explicit non-goals:** No Web UI, reply notification, thread hierarchy or mutable reply target.
- **Acceptance criteria:** Account/guest room and both DM directions work; cross-context/system-card/unavailable returns stable non-leaking 409; delete↔reply race creates either valid reply or none, never leak/partial.
- **Targeted verification:** planned test `apps/api/test/g33-reply-api.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g33-reply-api.test.js`; required job: `goal-g33`; case IDs `G33-A01`, `G33-A02`; fixtures: guest/account/system/cross-context/delete-race/reconnect fixtures; highest proof **P3**; expected artifacts `ci-bundle.g33.json`, `approval-envelope.g33.json`, `merge-envelope.g33.json`, test report and OCI evidence digest.
- **Capability / rollback:** `replies=false`; old clients ignore optional fields.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G34 — reply web ux

- **Branch:** `feature/2.5.0-g34-reply-web-ux`.
- **PR title:** `feat(web): add accessible reply compose and jump`.
- **Depends on:** G33; operationally, green G33 merge envelope.
- **Objective:** Add room/DM reply action, two-line preview, Escape/cancel, draft retention and around jump with non-recursive display.
- **Writable literal paths:** `apps/web/src/lib/shared/chat/reply-store.svelte.ts`; `apps/web/src/lib/shared/chat/ReplyPreview.svelte`; `apps/web/src/lib/shared/chat/ReplyComposer.svelte`; `apps/web/src/lib/shared/components/ChatText.svelte`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/src/lib/features/home/components/lobby/DmView.svelte`; `apps/web/e2e/g34-reply-ux.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/messaging-send.js`; `packages/shared/src/messaging-history.js`; `apps/web/src/lib/api/rooms.ts`; `apps/web/src/lib/api/dm.ts`.
- **Explicit non-goals:** No threads, reply notification inbox, system-card target or mobile redesign.
- **Acceptance criteria:** Loaded/unloaded/deleted/expired and reply-to-reply target flows pass; error keeps draft; focus/keyboard/screen-reader/touch target pass; preview never recursively expands.
- **Targeted verification:** planned test `apps/web/e2e/g34-reply-ux.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g34-reply-ux.spec.ts`; required job: `goal-g34`; case IDs `G34-A01`, `G34-A02`; fixtures: room guest/account, DM, reply-to-reply, deleted/expired target; highest proof **P3**; expected artifacts `ci-bundle.g34.json`, `approval-envelope.g34.json`, `merge-envelope.g34.json`, test report and OCI evidence digest.
- **Capability / rollback:** Enable `replies` after API/Web staging; false hides controls and ignores optional projection.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G35 — fenced lease primitive

- **Branch:** `feature/2.5.0-g35-fenced-lease-primitive`.
- **PR title:** `feat(api): add the reusable fenced lease lifecycle`.
- **Depends on:** G34; operationally, green G34 merge envelope.
- **Objective:** Implement domain-neutral claim/renew/fencing/loss/backoff/shutdown mechanics without sharing domain identities.
- **Writable literal paths:** `apps/api/src/platform/lease-runtime.js`; `apps/api/test/g35-lease-runtime.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/db.js`; `apps/api/src/lib/listen.js`.
- **Explicit non-goals:** No outbox/media tables, provider I/O, API-listener timer or domain status semantics.
- **Acceptance criteria:** Two workers never own same fencing token; lock/lease loss aborts commit; expired lease recovers; shutdown stops claims; backoff is bounded/deterministic.
- **Targeted verification:** planned test `apps/api/test/g35-lease-runtime.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g35-lease-runtime.test.js`; required job: `goal-g35`; case IDs `G35-A01`, `G35-A02`; fixtures: two workers, forced lock-loss, clock advance, crash and shutdown fixtures; highest proof **P3**; expected artifacts `ci-bundle.g35.json`, `approval-envelope.g35.json`, `merge-envelope.g35.json`, test report and OCI evidence digest.
- **Capability / rollback:** Primitive unused until workers; revert before consumers only.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G36 — idempotent send ledger

- **Branch:** `feature/2.5.0-g36-idempotent-send-ledger`.
- **PR title:** `feat(api): make room and DM sends idempotent`.
- **Depends on:** G35; operationally, green G35 merge envelope.
- **Objective:** Add bounded fingerprinted send ledger and atomic response replay for account/guest room and DM.
- **Writable literal paths:** `apps/api/src/migrations/20260718124000_create_message_send_idempotency.js`; `apps/api/src/domains/messaging/message-idempotency-repository.js`; `apps/api/src/domains/messaging/message-service.js`; `apps/api/src/domains/messaging/message-routes.js`; `apps/api/src/app.js`; `apps/api/test/g36-idempotent-send.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/friend-store.js`; `apps/api/src/lib/room-store.js`; `apps/api/src/lib/db.js`; `packages/shared/src/messaging-send.js`.
- **Explicit non-goals:** No Web retry, delivery outbox or exactly-once external promise.
- **Acceptance criteria:** Concurrent same key/fingerprint yields one message/original response; mismatch 409; actor/context isolation; retention/quota bounded; legacy no-key remains compatible without duplicate guarantee.
- **Targeted verification:** planned test `apps/api/test/g36-idempotent-send.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g36-idempotent-send.test.js`; required job: `goal-g36`; case IDs `G36-A01`, `G36-A02`; fixtures: account/guest/DM concurrent requests and timeout-after-commit proxy; highest proof **P3**; expected artifacts `ci-bundle.g36.json`, `approval-envelope.g36.json`, `merge-envelope.g36.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.idempotentSend=false`; ledger retained and ignored on binary rollback.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G37 — message outbox intent uow

- **Branch:** `feature/2.5.0-g37-message-outbox-intent-uow`.
- **PR title:** `feat(api): atomically persist message delivery intents`.
- **Depends on:** G36; operationally, green G36 merge envelope.
- **Objective:** Create additive message-delivery outbox schema/repository and persist inert domain intents in the indivisible message UoW before any worker exists.
- **Writable literal paths:** `apps/api/src/migrations/20260718125000_create_message_delivery_outbox.js`; `apps/api/src/domains/messaging/message-outbox-repository.js`; `apps/api/src/domains/messaging/message-service.js`; `apps/api/test/g37-message-outbox-uow.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/db.js`; `apps/api/src/realtime/account-events.js`; `apps/api/src/realtime/registry.js`; `apps/api/src/domains/messaging/room-message-repository.js`; `apps/api/src/domains/messaging/direct-message-repository.js`; `apps/api/src/domains/messaging/message-idempotency-repository.js`.
- **Explicit non-goals:** No worker entrypoint, claim/lease/provider side effect, notification_outbox identity, client cutover or API-listener timer.
- **Acceptance criteria:** Fresh/v2.4.2 upgrade/repeated no-op/≤5s lock/application rollback pass; message+inert intent commit or roll back together at every failure point; unique logical key prevents duplicates; old binary ignores retained rows.
- **Targeted verification:** planned test `apps/api/test/g37-message-outbox-uow.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g37-message-outbox-uow.test.js`; required job: `goal-g37`; case IDs `G37-A01`, `G37-A02`; fixtures: fresh/upgrade/no-op/lock/application-rollback DB, commit failure points, concurrent duplicate logical key and N-1 binary; highest proof **P3**; expected artifacts `ci-bundle.g37.json`, `approval-envelope.g37.json`, `merge-envelope.g37.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.messageDelivery` remains false and `op.message.dispatch.claim=false`; additive rows are inert and retained.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G38 — message delivery worker entrypoint

- **Branch:** `feature/2.5.0-g38-message-delivery-worker-entrypoint`.
- **PR title:** `feat(api): add the fenced message delivery worker`.
- **Depends on:** G37; operationally, green G37 merge envelope.
- **Objective:** Run G37 intents from a separately deployable same-image message-delivery entrypoint using the shared fenced lease primitive and domain-specific identity.
- **Writable literal paths:** `apps/api/src/workers/message-delivery.js`; `docker-compose.yml`; `docker-compose.ci.yml`; `apps/api/test/g38-message-delivery-worker.test.js`.
- **Read-only literal paths:** `apps/api/src/domains/messaging/message-outbox-repository.js`; `apps/api/src/realtime/account-events.js`; `apps/api/src/realtime/registry.js`; `apps/api/src/server.js`; `apps/api/src/platform/lease-runtime.js`; `apps/api/src/lib/config.js`.
- **Explicit non-goals:** No schema/message UoW change, notification identity, Web retry cutover, public key, API-listener timer, second lease primitive/owner/file, or edit to G35-owned `apps/api/src/platform/lease-runtime.js`.
- **Acceptance criteria:** The worker imports G35 `lease-runtime.js` read-only and supplies only message-delivery identity/adapter callbacks; no second claim/renew/fence/backoff implementation exists. Heartbeat/readiness, double-worker fencing, lost-fence abort, crash windows, duplicate/reorder, poison/dead retention, restart and shutdown pass; listener starts no timer.
- **Targeted verification:** planned test `apps/api/test/g38-message-delivery-worker.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g38-message-delivery-worker.test.js`; required job: `goal-g38`; case IDs `G38-A01`, `G38-A02`; fixtures: double worker, lock-loss, crash windows, poison/restart/shutdown and duplicate event corpus; highest proof **P3**; expected artifacts `ci-bundle.g38.json`, `approval-envelope.g38.json`, `merge-envelope.g38.json`, test report and OCI evidence digest.
- **Capability / rollback:** `op.message.dispatch.claim=false` by default; rollback stops claims, preserves intents and leaves legacy direct emission until G40 cutover.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G39 — message client shadow

- **Branch:** `feature/2.5.0-g39-message-client-shadow`.
- **PR title:** `feat(web): add duplicate-safe send shadow reconciliation`.
- **Depends on:** G38; operationally, green G38 merge envelope.
- **Objective:** Generate stable draft keys and reconcile response/realtime duplicates before server delivery cutover.
- **Writable literal paths:** `apps/web/src/lib/shared/chat/send-shadow.svelte.ts`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/src/lib/features/home/model/friends.svelte.ts`; `apps/web/src/lib/features/home/components/lobby/DmView.svelte`; `apps/web/src/lib/api/rooms.ts`; `apps/web/src/lib/api/dm.ts`; `apps/web/e2e/g39-send-shadow.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/messaging-send.js`; `packages/shared/src/messaging-history.js`; `apps/web/src/lib/api/realtime.ts`.
- **Explicit non-goals:** No server dispatcher cutover, offline queue or infinite retry.
- **Acceptance criteria:** Timeout/retry/reload under legacy/direct and shadow outbox paths shows one optimistic/canonical row; fingerprint change gets new key; flag-off works.
- **Targeted verification:** planned test `apps/web/e2e/g39-send-shadow.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g39-send-shadow.spec.ts`; required job: `goal-g39`; case IDs `G39-A01`, `G39-A02`; fixtures: timeout-after-commit proxy, duplicate/reordered realtime, reload and two tabs; highest proof **P3**; expected artifacts `ci-bundle.g39.json`, `approval-envelope.g39.json`, `merge-envelope.g39.json`, test report and OCI evidence digest.
- **Capability / rollback:** Client shadow can deploy with dispatcher off; false profile uses legacy UI.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G40 — message dispatcher cutover

- **Branch:** `feature/2.5.0-g40-message-dispatcher-cutover`.
- **PR title:** `feat(api): cut messaging delivery to the durable outbox`.
- **Depends on:** G39; operationally, green G39 merge envelope.
- **Objective:** Disable direct emission only after shadow clients and activate fenced dispatcher with effective readiness.
- **Writable literal paths:** `apps/api/src/domains/messaging/message-service.js`; `apps/api/src/domains/messaging/message-outbox-repository.js`; `apps/api/src/workers/message-delivery.js`; `apps/api/src/platform/capabilities.js`; `apps/api/src/platform/readiness.js`; `apps/api/src/lib/config.js`; `apps/api/src/server.js`; `apps/api/test/g40-message-cutover.test.js`.
- **Read-only literal paths:** `apps/api/src/realtime/registry.js`; `apps/api/src/domains/messaging/message-idempotency-repository.js`; `config/capability-dag.v1.json`.
- **Explicit non-goals:** No notification worker, Web UI change or public production enablement.
- **Acceptance criteria:** Shadow comparison reports identical logical events; cutover emits one event under duplicate dispatch; worker unavailable makes effective idempotent-delivery readiness false; rollback re-enables direct path without duplicate DB message.
- **Targeted verification:** planned test `apps/api/test/g40-message-cutover.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g40-message-cutover.test.js`; required job: `goal-g40`; case IDs `G40-A01`, `G40-A02`; fixtures: shadow diff, worker heartbeat loss, duplicate dispatch and rollback fixture; highest proof **P3**; expected artifacts `ci-bundle.g40.json`, `approval-envelope.g40.json`, `merge-envelope.g40.json`, test report and OCI evidence digest.
- **Capability / rollback:** Operator cutover reversible; public keys remain false only with ledger+client, not worker internals.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G41 — active ban invariant

- **Branch:** `feature/2.5.0-g41-active-ban-invariant`.
- **PR title:** `fix(api): centralize expiry-aware room ban enforcement`.
- **Depends on:** G40; operationally, green G40 merge envelope.
- **Objective:** Use one active predicate/service for status, preview, chat, WS, LiveKit, membership eligibility and cap.
- **Writable literal paths:** `apps/api/src/domains/moderation/active-ban-repository.js`; `apps/api/src/domains/moderation/active-ban-service.js`; `apps/api/src/migrations/20260718125500_add_active_room_ban_indexes.js`; `apps/api/src/lib/room-store.js`; `apps/api/src/server.js`; `apps/api/src/lib/metrics.js`; `apps/api/test/g41-active-ban.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260710130000_add_room_bans.js`; `apps/api/src/lib/db.js`.
- **Explicit non-goals:** No temporary-ban management UI/API, reasons, roles/reports or deletion action.
- **Acceptance criteria:** Exact expiry unblocks; 100 expired rows consume zero cap; account/IP semantics deterministic; every named entry path calls one service; no PII metrics.
- **Targeted verification:** planned test `apps/api/test/g41-active-ban.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g41-active-ban.test.js`; required job: `goal-g41`; case IDs `G41-A01`, `G41-A02`; fixtures: exact-time, 100 expired, account/shared-IP, HTTP/WS/LiveKit/admission paths; highest proof **P3**; expected artifacts `ci-bundle.g41.json`, `approval-envelope.g41.json`, `merge-envelope.g41.json`, test report and OCI evidence digest.
- **Capability / rollback:** Legacy singular ban preserved; no moderationCenter capability.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G42 — messaging staging checkpoint

- **Branch:** `feature/2.5.0-g42-messaging-staging-checkpoint`.
- **PR title:** `test(staging): close the immutable messaging wave`.
- **Depends on:** G41; operationally, green G41 merge envelope.
- **Objective:** Consolidate G01–G41 evidence and deploy exact digests to internal staging for full messaging/off/N-1/pairwise checkpoint.
- **Writable literal paths:** `docs/releases/2.5.0/evidence/index.json`; `.github/workflows/checkpoint.yml`; `scripts/checkpoints/messaging.mjs`; `scripts/test/g42-messaging-checkpoint.test.mjs`.
- **Read-only literal paths:** `docs/RELEASE_2.5.0_PLAN.md`; `docs/RELEASE_2.5.0_TEST_SPEC.md`; `.github/workflows/ci.yml`; `config/capability-dag.v1.json`; `config/evidence/release-evidence-archive.v1.json`; `scripts/evidence/recover-from-oci.mjs`.
- **Explicit non-goals:** No next-wave branch, public production enablement or feature implementation; failures use repair branches.
- **Acceptance criteria:** All predecessor checksum links validate; history/read/replies/idempotency/outbox/bans run full-on, all-off and pairwise operator/capability matrix; ≥60m observation has zero stop threshold.
- **Targeted verification:** planned test `scripts/test/g42-messaging-checkpoint.test.mjs`; exact command: `node scripts/test/g42-messaging-checkpoint.test.mjs --verify`; required job: `goal-g42-checkpoint`; case IDs `G42-A01`, `G42-A02`; fixtures: immutable digests, v2.4.2 client/binary read fixtures, worker-loss and all-on matrix; highest proof **P4**; expected artifacts `ci-bundle.g42.json`, `approval-envelope.g42.json`, `merge-envelope.g42.json`, test report and OCI evidence digest.
- **Capability / rollback:** Failure blocks G43; rollback to prior staging digests and repair current wave.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G43 — active only membership schema

- **Branch:** `feature/2.5.0-g43-active-only-membership-schema`.
- **PR title:** `feat(api): preserve active-only room membership semantics`.
- **Depends on:** G42 and approved strict LKV architecture; operationally, green G42 merge envelope.
- **Objective:** Use the existing `room_memberships` relation unchanged as the sufficient active-only schema and add repository/contracts around that truth; introduce no migration in G43.
- **Writable literal paths:** `packages/shared/src/membership.js`; `packages/shared/src/membership.d.ts`; `packages/shared/package.json`; `apps/api/src/domains/membership/membership-repository.js`; `apps/api/src/domains/membership/membership-service.js`; `apps/api/test/g43-membership-schema.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260615140000_create_room_memberships_and_bookmarks.js`; `apps/api/src/lib/room-store.js`; `apps/api/src/lib/db.js`.
- **Explicit non-goals:** No state/left column, history table, admission integration, UI or room privacy.
- **Acceptance criteria:** Row existence means active; unique room/user; owner rows unchanged; v2.4.2 behavioral owner quota/visibility/recipient queries return identical results after upgrade. The existing unique active row is proven sufficient. Any later measured schema/index need is a material plan amendment that must name an exact migration file before G43 restarts; it is not conditionally created inside this card.
- **Targeted verification:** planned test `apps/api/test/g43-membership-schema.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g43-membership-schema.test.js`; required job: `goal-g43`; case IDs `G43-A01`, `G43-A02`; fixtures: owner/member/bookmark/summary-recipient and v2.4.2 query fixtures; highest proof **P3**; expected artifacts `ci-bundle.g43.json`, `approval-envelope.g43.json`, `merge-envelope.g43.json`, test report and OCI evidence digest.
- **Capability / rollback:** `membership=false`; no schema mutation or tombstone exists, so v2.4.2 active-row behavior remains the rollback truth.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G44 — membership admission

- **Branch:** `feature/2.5.0-g44-membership-admission`.
- **PR title:** `feat(api): persist successful registered admission`.
- **Depends on:** G43; operationally, green G43 merge envelope.
- **Objective:** Create exactly one membership after successful registered admission through one service; guests/failures create none.
- **Writable literal paths:** `apps/api/src/domains/membership/membership-service.js`; `apps/api/src/domains/membership/membership-repository.js`; `apps/api/src/domains/membership/membership-routes.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/src/realtime/room-runtime.js`; `apps/api/src/realtime/ws-handler.js`; `apps/api/src/lib/room-store.js`; `apps/api/test/g44-membership-admission.test.js`.
- **Read-only literal paths:** `apps/api/src/domains/moderation/active-ban-service.js`; `docs/ADR_LIVEKIT_CREDENTIAL_BOUNDARY.md`; `packages/shared/src/membership.js`.
- **Explicit non-goals:** No directory/UI/leave, guest membership, private rooms or credential cutover.
- **Acceptance criteria:** Concurrent successful joins converge to one row; denied/failed/guest paths leave zero; ban between eligibility/write/token mint cannot create an admitted bypass.
- **Targeted verification:** planned test `apps/api/test/g44-membership-admission.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g44-membership-admission.test.js`; required job: `goal-g44`; case IDs `G44-A01`, `G44-A02`; fixtures: HTTP/WS/LiveKit join races, guest, ban, token-mint failure; highest proof **P3**; expected artifacts `ci-bundle.g44.json`, `approval-envelope.g44.json`, `merge-envelope.g44.json`, test report and OCI evidence digest.
- **Capability / rollback:** Writes operator-disabled until strict cutover; rows harmless active membership.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G45 — members directory api

- **Branch:** `feature/2.5.0-g45-members-directory-api`.
- **PR title:** `feat(api): add paginated members directory and search`.
- **Depends on:** G44; operationally, green G44 merge envelope.
- **Objective:** Expose owner/active-member authorized offline directory using platform cursors and presence projection.
- **Writable literal paths:** `apps/api/src/domains/membership/member-directory-service.js`; `apps/api/src/domains/membership/membership-routes.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/test/g45-members-directory.test.js`.
- **Read-only literal paths:** `apps/api/src/domains/membership/membership-repository.js`; `packages/shared/src/membership.js`; `packages/shared/src/membership.d.ts`; `apps/api/src/lib/room-store.js`; `apps/api/src/realtime/registry.js`; `apps/api/src/platform/cursor-codec.js`.
- **Explicit non-goals:** No global search, mention relation, room privacy or Web roster.
- **Acceptance criteria:** Default50/max100; p95≤200ms autocomplete at 10k; owner/creator eligible active member appears; guest/nonmember gets public voice roster only; no cross-room/IP/device/session leak.
- **Targeted verification:** planned test `apps/api/test/g45-members-directory.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g45-members-directory.test.js`; required job: `goal-g45`; case IDs `G45-A01`, `G45-A02`; fixtures: 10k members, same names, creator/owner, presence churn, guest/cross-room cursor; highest proof **P3**; expected artifacts `ci-bundle.g45.json`, `approval-envelope.g45.json`, `merge-envelope.g45.json`, test report and OCI evidence digest.
- **Capability / rollback:** `membership=false`; route hidden or legacy profile until roster/cutover.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G46 — offline roster web

- **Branch:** `feature/2.5.0-g46-offline-roster-web`.
- **PR title:** `feat(web): add persistent offline room roster`.
- **Depends on:** G45; operationally, green G45 merge envelope.
- **Objective:** Render paginated members grouped voice/other, dedupe multiple connections and resync by presenceRevision.
- **Writable literal paths:** `apps/web/src/lib/api/memberships.ts`; `apps/web/src/lib/features/home/model/room-membership.svelte.ts`; `apps/web/src/lib/features/home/components/lobby/RoomMemberList.svelte`; `apps/web/src/lib/features/home/components/lobby/RoomPreviewView.svelte`; `apps/web/src/lib/features/room/components/ParticipantList.svelte`; `apps/web/e2e/g46-roster.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/membership.js`; `apps/web/src/lib/api/realtime.ts`; `apps/web/src/lib/platform/capability-state.svelte.ts`.
- **Explicit non-goals:** No mentions autocomplete, roles/moderation, room privacy or mobile UI.
- **Acceptance criteria:** Offline rows survive disconnect/reload; multiple connections one row; revision gap resyncs; same names distinguish; keyboard/search/loading/error a11y pass.
- **Targeted verification:** planned test `apps/web/e2e/g46-roster.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g46-roster.spec.ts`; required job: `goal-g46`; case IDs `G46-A01`, `G46-A02`; fixtures: two accounts/multitab/offline/reload/revision gap/10k search; highest proof **P3**; expected artifacts `ci-bundle.g46.json`, `approval-envelope.g46.json`, `merge-envelope.g46.json`, test report and OCI evidence digest.
- **Capability / rollback:** UI behind membership; false uses current presence-only roster.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G47 — strict credential core

- **Branch:** `feature/2.5.0-g47-strict-credential-core`.
- **PR title:** `feat(api): implement the approved strict credential boundary`.
- **Depends on:** G46 and G05/amendment approval; operationally, green G46 merge envelope.
- **Objective:** Implement the approved external auth-gate admission epoch/revoke/controller mechanism with fenced persistence/config and no weaker fallback.
- **Writable literal paths:** `apps/api/src/domains/admission/credential-boundary-service.js`; `apps/api/src/domains/admission/livekit-credential-provider.js`; `apps/api/src/domains/admission/livekit-auth-gate-service.js`; `apps/api/src/domains/admission/gate-credential-signer.js`; `apps/api/src/migrations/20260720160000_create_livekit_gate_credentials.js`; `config/livekit/external-auth-gate.v1.json`; `apps/api/src/lib/config.js`; `docker-compose.lkv.yml`; `apps/api/test/g47-credential-core.test.js`; `docs/releases/2.5.0/amendments/G47-MIGRATION-CATALOG.json`.
- **Read-only literal paths:** `docs/ADR_LIVEKIT_CREDENTIAL_BOUNDARY.md`; `scripts/lkv/run-strict-boundary-proof.mjs`; `apps/api/src/server.js`; `docker-compose.yml`; `apps/api/src/domains/membership/membership-service.js`; `apps/api/src/domains/moderation/active-ban-service.js`.
- **Explicit non-goals:** No public cutover, leave UI, bounded replay or unapproved topology change.
- **Acceptance criteria:** Issued gate credential binds current admission; the sole public WSS gate revalidates before LiveKit connection; LiveKit `7880` is internal-only; revoke/leave/ban commit increments the room epoch before RemoveParticipant/success; same credential fails after restart/partition/clock/race; account id and room-scoped guest UUID are persisted while IP is ban-only; no positive cache survives a PostgreSQL uncertainty; readiness false if controller/provider unavailable. The listed credential service/provider/gate/config/migration files are valid only for the external auth-gate shape approved by G05. Any material mechanism change must amend the PRD/spec and exact G47 literal path catalog before a G47 branch starts; no inferred adapter, migration or topology file is allowed.
- **Targeted verification:** planned test `apps/api/test/g47-credential-core.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g47-credential-core.test.js`; required job: `goal-g47`; case IDs `G47-A01`, `G47-A02`; fixtures: approved external auth-gate topology, stolen token, restart, partition, clock skew, concurrent mint-revoke, leave, ban, explicit revoke, guest IP-ban-only identity and closed gate-on-store-uncertainty; highest proof **P3**; expected artifacts `ci-bundle.g47.json`, `approval-envelope.g47.json`, `merge-envelope.g47.json`, test report and OCI evidence digest. Additional fixtures reject a G05 mechanism digest or topology whose required file set differs from the approved G47 catalog without a prior plan amendment.
- **Capability / rollback:** Operator off and current path retained only if it cannot violate strict truth; failure BLOCKS.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G48 — livekit membership cutover

- **Branch:** `feature/2.5.0-g48-livekit-membership-cutover`.
- **PR title:** `feat(realtime): enforce membership and strict revocation on voice admission`.
- **Depends on:** G47; operationally, green G47 merge envelope.
- **Objective:** Route HTTP token, WS reconnect, LiveKit admission, ban/removal through membership and the strict external auth-gate credential boundary.
- **Writable literal paths:** `apps/api/src/server.js`; `apps/api/src/realtime/room-runtime.js`; `apps/api/src/realtime/ws-handler.js`; `apps/api/src/domains/admission/credential-boundary-service.js`; `apps/api/src/domains/admission/livekit-credential-provider.js`; `apps/api/src/domains/admission/livekit-auth-gate-service.js`; `apps/api/src/domains/admission/gate-credential-signer.js`; `apps/api/src/domains/membership/membership-service.js`; `apps/api/test/g48-livekit-cutover.test.js`.
- **Read-only literal paths:** `docs/ADR_LIVEKIT_CREDENTIAL_BOUNDARY.md`; `config/livekit/external-auth-gate.v1.json`; `apps/api/src/migrations/20260720160000_create_livekit_gate_credentials.js`; `docs/releases/2.5.0/amendments/G47-MIGRATION-CATALOG.json`; `apps/api/src/domains/moderation/active-ban-service.js`; `docker-compose.lkv.yml`.
- **Explicit non-goals:** No leave UI, private room or guest membership.
- **Acceptance criteria:** Member/ban state consistent; the browser reaches LiveKit only through the sole public WSS gate; same gate credential denied after revoke/leave/ban across all paths; multi-tab/concurrent reconnect cannot bypass; guest contract remains account id/room-scoped guest UUID with IP ban-only; every success observes revoke commit before RemoveParticipant/success and fails closed on gate/controller uncertainty.
- **Targeted verification:** planned test `apps/api/test/g48-livekit-cutover.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g48-livekit-cutover.test.js`; required job: `goal-g48`; case IDs `G48-A01`, `G48-A02`; fixtures: real HTTP/WS/LiveKit multitab, ban during mint, restart, partition replay, stolen gate credential, leave, explicit revoke, clock skew, guest IP ban-only and internal `7880` direct-connect rejection; highest proof **P3**; expected artifacts `ci-bundle.g48.json`, `approval-envelope.g48.json`, `merge-envelope.g48.json`, test report and OCI evidence digest.
- **Capability / rollback:** Effective membership false if strict controller unhealthy; no bounded fallback.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G49 — leave delete rejoin

- **Branch:** `feature/2.5.0-g49-leave-delete-rejoin`.
- **PR title:** `feat(room): add active-only leave and safe rejoin`.
- **Depends on:** G48; operationally, green G48 merge envelope.
- **Objective:** Implement leave-call preserve, leave-room disconnect/revoke then DELETE membership, owner guard and idempotent rejoin.
- **Writable literal paths:** `apps/api/src/domains/membership/membership-routes.js`; `apps/api/src/domains/membership/membership-service.js`; `apps/api/src/realtime/room-runtime.js`; `apps/api/src/realtime/ws-handler.js`; `apps/web/src/lib/features/home/model/room-membership.svelte.ts`; `apps/web/src/lib/features/home/components/lobby/RoomPreviewView.svelte`; `apps/web/src/lib/features/room/components/RoomDock.svelte`; `apps/web/src/lib/features/room/voice-session.svelte.ts`; `apps/web/e2e/g49-leave-rejoin.spec.ts`.
- **Read-only literal paths:** `docs/RELEASE_2.5.0_PLAN.md`; `apps/api/src/lib/room-store.js`; `apps/api/src/domains/admission/credential-boundary-service.js`; `apps/web/src/lib/api/memberships.ts`.
- **Explicit non-goals:** No left history/tombstone, ownership transfer, room privacy or deletion history.
- **Acceptance criteria:** Failed delete leaves active/retryable; successful leave deletes one row and denies same token; ban preserves membership; owner cannot orphan; rejoin inserts one row; all tabs/roster converge.
- **Targeted verification:** planned test `apps/web/e2e/g49-leave-rejoin.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g49-leave-rejoin.spec.ts`; required job: `goal-g49`; case IDs `G49-A01`, `G49-A02`; fixtures: owner/member/guest, delete failure, ban, multitab, old JWT and rejoin; highest proof **P3**; expected artifacts `ci-bundle.g49.json`, `approval-envelope.g49.json`, `merge-envelope.g49.json`, test report and OCI evidence digest.
- **Capability / rollback:** After leave, enforcement cannot be disabled to reauthorize; false UI may hide action but rows remain truthful.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G50 — membership staging checkpoint

- **Branch:** `feature/2.5.0-g50-membership-staging-checkpoint`.
- **PR title:** `test(staging): close the immutable membership wave`.
- **Depends on:** G49; operationally, green G49 merge envelope.
- **Objective:** Consolidate membership evidence and run messaging+membership full/off/pairwise staging including behavioral N-1.
- **Writable literal paths:** `docs/releases/2.5.0/evidence/index.json`; `.github/workflows/checkpoint.yml`; `scripts/checkpoints/membership.mjs`; `scripts/test/g50-membership-checkpoint.test.mjs`.
- **Read-only literal paths:** `scripts/checkpoints/messaging.mjs`; `config/capability-dag.v1.json`; `apps/api/src/domains/membership/membership-service.js`; `apps/api/src/domains/admission/credential-boundary-service.js`; `scripts/evidence/recover-from-oci.mjs`.
- **Explicit non-goals:** No engagement branch/public rollout; failures use current-wave repair branch.
- **Acceptance criteria:** v2.4.2 owner quota/visible-room/summary-recipient/legacy reads plus new directory/leave/rejoin pass; strict same-token denial passes; all completed capabilities full-on/off/pairwise observe ≥60m.
- **Targeted verification:** planned test `scripts/test/g50-membership-checkpoint.test.mjs`; exact command: `node scripts/test/g50-membership-checkpoint.test.mjs --verify`; required job: `goal-g50-checkpoint`; case IDs `G50-A01`, `G50-A02`; fixtures: v2.4.2 binary/client, owner/bookmark/recipient/directory, token replay and all-on fixture; highest proof **P4**; expected artifacts `ci-bundle.g50.json`, `approval-envelope.g50.json`, `merge-envelope.g50.json`, test report and OCI evidence digest.
- **Capability / rollback:** Failure blocks G51; rollback to messaging checkpoint digests and repair.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G51 — structured content contract

- **Branch:** `feature/2.5.0-g51-structured-content-contract`.
- **PR title:** `feat(shared): define structured room content with text fallback`.
- **Depends on:** G50; operationally, green G50 merge envelope.
- **Objective:** Define RoomMessageContentV1 validation/projection and legacy text fallback without schema, backfill or API integration.
- **Writable literal paths:** `packages/shared/src/room-message-content.js`; `packages/shared/src/room-message-content.d.ts`; `packages/shared/package.json`; `packages/shared/test/g51-content-contract.test.js`.
- **Read-only literal paths:** `packages/shared/src/validation.js`; `packages/shared/src/realtime.js`; `apps/api/src/server.js`.
- **Explicit non-goals:** No migration, backfill, API adapter/write, mentions, Web editor, trusted HTML, structured DM or notification.
- **Acceptance criteria:** Invalid version/size/segment/raw HTML rejects; known content projects deterministic text; null/unknown version consumes legacy text; CJS/ESM/types and Cyrillic/emoji/link/XSS corpus agree.
- **Targeted verification:** planned test `packages/shared/test/g51-content-contract.test.js`; exact command: `node --test packages/shared/test/g51-content-contract.test.js`; required job: `goal-g51`; case IDs `G51-A01`, `G51-A02`; fixtures: Cyrillic/emoji/multiline/link/XSS/null/unknown-version and malformed segment corpus; highest proof **P1**; expected artifacts `ci-bundle.g51.json`, `approval-envelope.g51.json`, `merge-envelope.g51.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.structuredContent=false`; the public `engagement` key remains false and text stays authoritative.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G52 — structured content persistence adapter

- **Branch:** `feature/2.5.0-g52-structured-content-persistence-adapter`.
- **PR title:** `feat(api): add structured content storage and read fallback`.
- **Depends on:** G51; operationally, green G51 merge envelope.
- **Objective:** Add nullable canonical content storage, bounded backfill and API read adapter while retaining text NOT NULL and legacy envelopes.
- **Writable literal paths:** `apps/api/src/migrations/20260718131000_add_room_message_structured_content.js`; `apps/api/src/domains/messaging/content-repository.js`; `apps/api/src/domains/messaging/content-projector.js`; `apps/api/test/g52-content-persistence.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260614144500_create_rooms_and_room_messages.js`; `apps/api/src/server.js`; `apps/api/src/lib/room-store.js`; `packages/shared/src/room-message-content.js`; `apps/api/src/lib/migrate.js`.
- **Explicit non-goals:** No canonical create/edit UoW cutover, mention extraction, Web editor, trusted HTML, structured DM or notification.
- **Acceptance criteria:** Fresh/v2.4.2 upgrade/repeated no-op/batch1000 backfill/≤5s lock/application rollback pass; null/unknown reads text, known content projects exactly, N-1 starts/reads and additive column/index stay inert.
- **Targeted verification:** planned test `apps/api/test/g52-content-persistence.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g52-content-persistence.test.js`; required job: `goal-g52`; case IDs `G52-A01`, `G52-A02`; fixtures: fresh/upgrade/no-op/lock/application-rollback DB, 10k mixed backfill, null/unknown/known content and N-1 binary; highest proof **P3**; expected artifacts `ci-bundle.g52.json`, `approval-envelope.g52.json`, `merge-envelope.g52.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.structuredContent=false`; application rollback ignores nullable content and continues text; additive schema is retained.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G53 — structured content uow

- **Branch:** `feature/2.5.0-g53-structured-content-uow`.
- **PR title:** `feat(api): route room content through the messaging UoW`.
- **Depends on:** G52; operationally, green G52 merge envelope.
- **Objective:** Make message create/edit/delete canonical content/text atomic under messaging service and injected transaction.
- **Writable literal paths:** `apps/api/src/domains/messaging/message-service.js`; `apps/api/src/domains/messaging/room-message-repository.js`; `apps/api/src/domains/messaging/content-repository.js`; `apps/api/test/g53-content-uow.test.js`.
- **Read-only literal paths:** `apps/api/src/server.js`; `apps/api/src/lib/room-store.js`; `apps/api/src/lib/db.js`; `packages/shared/src/room-message-content.js`.
- **Explicit non-goals:** No mention/inbox/outbox repository yet or async in-process atomicity.
- **Acceptance criteria:** Every injected repository/commit failure leaves no partial message/content; legacy text request/response unchanged; one write owner enforced.
- **Targeted verification:** planned test `apps/api/test/g53-content-uow.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g53-content-uow.test.js`; required job: `goal-g53`; case IDs `G53-A01`, `G53-A02`; fixtures: failure before/after message write/commit, legacy/new content and concurrent edit; highest proof **P3**; expected artifacts `ci-bundle.g53.json`, `approval-envelope.g53.json`, `merge-envelope.g53.json`, test report and OCI evidence digest.
- **Capability / rollback:** Capability false; legacy text-only path through same UoW.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G54 — structured content web

- **Branch:** `feature/2.5.0-g54-structured-content-web`.
- **PR title:** `feat(web): render and compose canonical structured content`.
- **Depends on:** G53; operationally, green G53 merge envelope.
- **Objective:** Add safe renderer/text-first editor prepared for selected mention segments.
- **Writable literal paths:** `apps/web/src/lib/shared/chat/StructuredMessageContent.svelte`; `apps/web/src/lib/shared/chat/StructuredMessageComposer.svelte`; `apps/web/src/lib/shared/components/ChatText.svelte`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/test/g54-content-dom.test.js`.
- **Read-only literal paths:** `packages/shared/src/room-message-content.js`; `apps/web/src/lib/shared/utils/linkify.ts`; `apps/web/src/lib/api/rooms.ts`.
- **Explicit non-goals:** No active mention search, raw HTML, structured DM or reactions.
- **Acceptance criteria:** Known segments safe; unknown/malformed fallback; client label untrusted; edit/IME/multiline/link/focus a11y pass; malicious corpus yields no DOM execution.
- **Targeted verification:** planned test `apps/web/test/g54-content-dom.test.js`; exact command: `node --test apps/web/test/g54-content-dom.test.js`; required job: `goal-g54`; case IDs `G54-A01`, `G54-A02`; fixtures: XSS/link/Cyrillic/emoji/IME/unknown-version DOM fixtures; highest proof **P2**; expected artifacts `ci-bundle.g54.json`, `approval-envelope.g54.json`, `merge-envelope.g54.json`, test report and OCI evidence digest.
- **Capability / rollback:** Flag false renders/sends legacy text.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G55 — mention relations eligibility

- **Branch:** `feature/2.5.0-g55-mention-relations-eligibility`.
- **PR title:** `feat(api): add room mention relations and eligibility`.
- **Depends on:** G54; operationally, green G54 merge envelope.
- **Objective:** Add relation schema and server eligibility for registered active creator and up to five unique active targets.
- **Writable literal paths:** `packages/shared/src/mentions.js`; `packages/shared/src/mentions.d.ts`; `packages/shared/package.json`; `apps/api/src/migrations/20260718132000_create_room_message_mentions.js`; `apps/api/src/domains/notifications/mention-repository.js`; `apps/api/src/domains/notifications/mention-eligibility-service.js`; `apps/api/test/g55-mention-domain.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260615140000_create_room_memberships_and_bookmarks.js`; `apps/api/src/domains/membership/membership-service.js`; `apps/api/src/lib/notification-store.js`; `packages/shared/src/room-message-content.js`.
- **Explicit non-goals:** No inbox/outbox rows, Web composer, DM mentions, @everyone/@here or pasted-text conversion.
- **Acceptance criteria:** Creator must be active registered member; guest/nonmember cannot create; target owner/creator is eligible unless self; self/guest/removed/banned/cross-room reject without leak; relation lifecycle unique.
- **Targeted verification:** planned test `apps/api/test/g55-mention-domain.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g55-mention-domain.test.js`; required job: `goal-g55`; case IDs `G55-A01`, `G55-A02`; fixtures: creator/owner/self/guest/banned/cross-room, duplicate and edit/delete/TTL fixtures; highest proof **P3**; expected artifacts `ci-bundle.g55.json`, `approval-envelope.g55.json`, `merge-envelope.g55.json`, test report and OCI evidence digest.
- **Capability / rollback:** `mentions=false`; relations inert; content text fallback remains.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G56 — notification schema inert outbox

- **Branch:** `feature/2.5.0-g56-notification-schema-inert-outbox`.
- **PR title:** `feat(api): add inbox and inert notification outbox schema`.
- **Depends on:** G55; operationally, green G55 merge envelope.
- **Objective:** Create user_notifications and notification_outbox together with reason/revision/channel uniqueness before atomic UoW.
- **Writable literal paths:** `apps/api/src/migrations/20260718133000_create_notification_inbox_and_outbox.js`; `apps/api/src/domains/notifications/inbox-repository.js`; `apps/api/src/domains/notifications/notification-outbox-repository.js`; `apps/api/test/g56-notification-schema.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260710140000_create_notification_preferences.js`; `apps/api/src/migrations/20260711130000_create_push_subscriptions.js`; `apps/api/src/migrations/20260711140000_add_user_dnd.js`; `apps/api/src/lib/notification-store.js`; `apps/api/src/lib/push-store.js`; `apps/api/src/lib/migrate.js`.
- **Explicit non-goals:** No message UoW integration, leasing/provider dispatch, API/UI or push cutover.
- **Acceptance criteria:** One logical recipient/source row; monotonic revision/retract/read; unique notification/revision/channel inert pending intent; fresh/upgrade/N-1 and bounded cursor indexes pass.
- **Targeted verification:** planned test `apps/api/test/g56-notification-schema.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g56-notification-schema.test.js`; required job: `goal-g56`; case IDs `G56-A01`, `G56-A02`; fixtures: mention+reply reason, retract/re-add, duplicate revision/channel and N-1 schema fixture; highest proof **P3**; expected artifacts `ci-bundle.g56.json`, `approval-envelope.g56.json`, `merge-envelope.g56.json`, test report and OCI evidence digest.
- **Capability / rollback:** Inbox/outbox capabilities/workers false; rows inert and retained.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G57 — message mention notification uow

- **Branch:** `feature/2.5.0-g57-message-mention-notification-uow`.
- **PR title:** `feat(api): atomically create mentions inbox and delivery intents`.
- **Depends on:** G56; operationally, green G56 merge envelope.
- **Objective:** Extend the indivisible messaging UoW to message, mention relations, inbox reasons and inert notification_outbox intents using injected client.
- **Writable literal paths:** `apps/api/src/domains/messaging/message-service.js`; `apps/api/src/domains/notifications/mention-repository.js`; `apps/api/src/domains/notifications/inbox-repository.js`; `apps/api/src/domains/notifications/notification-outbox-repository.js`; `apps/api/test/g57-addressed-uow.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/room-store.js`; `apps/api/src/lib/db.js`; `apps/api/src/lib/notification-store.js`; `apps/api/src/domains/messaging/room-message-repository.js`; `apps/api/src/domains/messaging/content-repository.js`.
- **Explicit non-goals:** No leasing/provider I/O, Web UI or splitting the atomic transaction.
- **Acceptance criteria:** Message+mentions+inbox+outbox all commit or all rollback; mention+reply merge one row; unchanged edit no revision; remove/re-add/delete/TTL transitions exact; five-mention send p95≤500ms in RC fixture.
- **Targeted verification:** planned test `apps/api/test/g57-addressed-uow.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g57-addressed-uow.test.js`; required job: `goal-g57`; case IDs `G57-A01`, `G57-A02`; fixtures: failure at each repository, five mentions, duplicate/retract/re-add/delete/TTL; highest proof **P3**; expected artifacts `ci-bundle.g57.json`, `approval-envelope.g57.json`, `merge-envelope.g57.json`, test report and OCI evidence digest.
- **Capability / rollback:** Public features false and intents inert; rollback ignores rows without data loss.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G58 — mention composer web

- **Branch:** `feature/2.5.0-g58-mention-composer-web`.
- **PR title:** `feat(web): add accessible member-driven mentions`.
- **Depends on:** G57; operationally, green G57 merge envelope.
- **Objective:** Add directory autocomplete that creates relations only after server-candidate selection.
- **Writable literal paths:** `apps/web/src/lib/shared/chat/MentionAutocomplete.svelte`; `apps/web/src/lib/shared/chat/mention-composer.svelte.ts`; `apps/web/src/lib/shared/chat/StructuredMessageComposer.svelte`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/e2e/g58-mentions.spec.ts`.
- **Read-only literal paths:** `apps/web/src/lib/api/memberships.ts`; `packages/shared/src/mentions.js`; `apps/web/src/lib/features/home/model/room-membership.svelte.ts`.
- **Explicit non-goals:** No DM mentions, pasted @ recognition, inbox UI or global search.
- **Acceptance criteria:** Max8 candidates; arrows/Enter/Tab/Escape/IME/touch/screen-reader pass; pasted/manual @ remains text; stale/banned send recovers; creator eligibility enforced.
- **Targeted verification:** planned test `apps/web/e2e/g58-mentions.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g58-mentions.spec.ts`; required job: `goal-g58`; case IDs `G58-A01`, `G58-A02`; fixtures: same names, owner/creator, pasted @, IME, target banned between select/send; highest proof **P3**; expected artifacts `ci-bundle.g58.json`, `approval-envelope.g58.json`, `merge-envelope.g58.json`, test report and OCI evidence digest.
- **Capability / rollback:** `mentions=false` until inbox ready; false editor is text-only.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G59 — notification inbox api

- **Branch:** `feature/2.5.0-g59-notification-inbox-api`.
- **PR title:** `feat(api): add cursor inbox and revisioned read APIs`.
- **Depends on:** G58; operationally, green G58 merge envelope.
- **Objective:** Expose read-only list/unread count and idempotent read/read-all/resync using platform cursor.
- **Writable literal paths:** `packages/shared/src/notifications.js`; `packages/shared/src/notifications.d.ts`; `packages/shared/package.json`; `apps/api/src/domains/notifications/notification-service.js`; `apps/api/src/domains/notifications/notification-routes.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/src/realtime/account-events.js`; `apps/api/test/g59-inbox-api.test.js`.
- **Read-only literal paths:** `apps/api/src/domains/notifications/inbox-repository.js`; `apps/api/src/lib/notification-store.js`; `apps/api/src/platform/cursor-codec.js`.
- **Explicit non-goals:** No Web UI, provider dispatch or reaction notification.
- **Acceptance criteria:** Default50/max100; GET zero writes; p95≤300ms/p99≤750ms; cross-user IDs/cursors do not leak; retracted omits text; tabs resync by revision.
- **Targeted verification:** planned test `apps/api/test/g59-inbox-api.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g59-inbox-api.test.js`; required job: `goal-g59`; case IDs `G59-A01`, `G59-A02`; fixtures: 100k inbox rows, read/retract race, cross-user cursor and GET-write audit; highest proof **P3**; expected artifacts `ci-bundle.g59.json`, `approval-envelope.g59.json`, `merge-envelope.g59.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.notificationInbox=false`; rows retained; legacy clients ignore events.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G60 — notification inbox web

- **Branch:** `feature/2.5.0-g60-notification-inbox-web`.
- **PR title:** `feat(web): add inbox badge list and safe deep links`.
- **Depends on:** G59; operationally, green G59 merge envelope.
- **Objective:** Build accessible inbox/read-all and cold/warm around deep link without voice auto-join.
- **Writable literal paths:** `apps/web/src/lib/shared/notifications/inbox.svelte.ts`; `apps/web/src/lib/features/home/components/NotificationInbox.svelte`; `apps/web/src/lib/api/notifications.ts`; `apps/web/src/lib/shared/notifications/router.ts`; `apps/web/e2e/g60-inbox.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/notifications.js`; `apps/web/src/routes/r/[roomId]/+page.svelte`; `apps/web/src/lib/api/realtime.ts`.
- **Explicit non-goals:** No push dispatcher, reaction notifications or mobile UI.
- **Acceptance criteria:** Pagination/error/empty/retracted/read states pass; tabs converge; latest/old/deleted/expired deep link works; zero LiveKit connect; focus/screen-reader pass.
- **Targeted verification:** planned test `apps/web/e2e/g60-inbox.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g60-inbox.spec.ts`; required job: `goal-g60`; case IDs `G60-A01`, `G60-A02`; fixtures: two tabs, old/deleted/expired messages, cold/warm navigation and LiveKit instrumentation; highest proof **P3**; expected artifacts `ci-bundle.g60.json`, `approval-envelope.g60.json`, `merge-envelope.g60.json`, test report and OCI evidence digest.
- **Capability / rollback:** Flag false hides inbox and ignores intent safely.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G61 — notification preference api

- **Branch:** `feature/2.5.0-g61-notification-preference-api`.
- **PR title:** `feat(api): add all mentions none room policy`.
- **Depends on:** G60; operationally, green G60 merge envelope.
- **Objective:** Add room-level schema/API and conservative dual-write rules before Web cutover.
- **Writable literal paths:** `apps/api/src/migrations/20260718134000_add_notification_levels.js`; `apps/api/src/lib/notification-store.js`; `apps/api/src/domains/notifications/notification-service.js`; `apps/api/src/domains/notifications/notification-routes.js`; `apps/api/test/g61-policy-api.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260710140000_create_notification_preferences.js`; `apps/api/src/migrations/20260711140000_add_user_dnd.js`; `packages/shared/src/notifications.js`.
- **Explicit non-goals:** No Web settings, provider worker or inbox deletion.
- **Acceptance criteria:** `all|mentions|none` validates; mentions/none write legacy mute, all removes; DND/privacy affects interrupts/body not inbox; v2.4.2 rollback sends no more than chosen.
- **Targeted verification:** planned test `apps/api/test/g61-policy-api.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g61-policy-api.test.js`; required job: `goal-g61`; case IDs `G61-A01`, `G61-A02`; fixtures: level×DND×privacy and v2.4.2 legacy-mute behavioral fixture; highest proof **P3**; expected artifacts `ci-bundle.g61.json`, `approval-envelope.g61.json`, `merge-envelope.g61.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.notificationPolicies=false`; conservative legacy mute retained.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G62 — notification settings web

- **Branch:** `feature/2.5.0-g62-notification-settings-web`.
- **PR title:** `feat(web): add room notification level settings`.
- **Depends on:** G61; operationally, green G61 merge envelope.
- **Objective:** Expose accessible policy controls and perform legacy/new shadow reconciliation before dispatch cutover.
- **Writable literal paths:** `apps/web/src/lib/features/home/components/SettingsModal.svelte`; `apps/web/src/lib/shared/notifications/preferences.svelte.ts`; `apps/web/src/lib/api/notifications.ts`; `apps/web/src/lib/shared/components/room-menu/RoomMenuContent.svelte`; `apps/web/e2e/g62-policy-settings.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/notifications.js`; `apps/web/src/lib/shared/notifications/inbox.svelte.ts`.
- **Explicit non-goals:** No provider dispatch, inbox removal or mobile settings redesign.
- **Acceptance criteria:** All levels save/reload/multitab; legacy server maps conservatively; DND/privacy text clear; keyboard/ARIA/error states pass.
- **Targeted verification:** planned test `apps/web/e2e/g62-policy-settings.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g62-policy-settings.spec.ts`; required job: `goal-g62`; case IDs `G62-A01`, `G62-A02`; fixtures: new/legacy API, two tabs, DND/privacy and failure fixture; highest proof **P3**; expected artifacts `ci-bundle.g62.json`, `approval-envelope.g62.json`, `merge-envelope.g62.json`, test report and OCI evidence digest.
- **Capability / rollback:** Policy UI flag false keeps existing mute control.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G63 — notification worker entrypoint

- **Branch:** `feature/2.5.0-g63-notification-worker-entrypoint`.
- **PR title:** `feat(api): add fenced notification provider worker`.
- **Depends on:** G62; operationally, green G62 merge envelope.
- **Objective:** Lease existing inert intents and deliver Web Push from separate same-image process using shared fencing.
- **Writable literal paths:** `apps/api/src/workers/notification-delivery.js`; `apps/api/src/domains/notifications/notification-outbox-repository.js`; `apps/api/src/domains/notifications/push-provider.js`; `apps/api/src/lib/push-service.js`; `apps/api/src/lib/push-store.js`; `docker-compose.yml`; `docker-compose.ci.yml`; `apps/api/test/g63-notification-worker.test.js`.
- **Read-only literal paths:** `apps/api/src/platform/lease-runtime.js`; `apps/api/src/lib/config.js`; `packages/shared/src/notifications.js`.
- **Explicit non-goals:** No server cutover, page Notification parallel channel or reaction notification.
- **Acceptance criteria:** Batch50, lease2m, backoff5s–1h, max8; lock loss aborts state commit; 404/410 terminal-removes subscription; any dead alerts, >10/10m disables; throughput≥100 jobs/s mock provider.
- **Targeted verification:** planned test `apps/api/test/g63-notification-worker.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g63-notification-worker.test.js`; required job: `goal-g63`; case IDs `G63-A01`, `G63-A02`; fixtures: double worker, lock-loss, restart, 404/410/5xx/timeout, poison and 100jobs/s; highest proof **P3**; expected artifacts `ci-bundle.g63.json`, `approval-envelope.g63.json`, `merge-envelope.g63.json`, test report and OCI evidence digest.
- **Capability / rollback:** Worker operator flag false; intents retained; API listener has no timer.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G64 — notification client shadow

- **Branch:** `feature/2.5.0-g64-notification-client-shadow`.
- **PR title:** `feat(web): add shadow-compatible notification dedupe`.
- **Depends on:** G63; operationally, green G63 merge envelope.
- **Objective:** Land SW/Web/Desktop revision/dedupe/focus/platform/privacy suppression before server provider cutover.
- **Writable literal paths:** `apps/web/src/service-worker.ts`; `apps/web/src/lib/shared/notifications/router.ts`; `apps/web/src/lib/shared/notifications/preferences.svelte.ts`; `apps/web/src/lib/platform/desktop-notification-bridge.ts`; `apps/web/e2e/g64-notification-shadow.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/notifications.js`; `apps/web/src/lib/shared/notifications/inbox.svelte.ts`; `apps/web/src/lib/features/home/model/push-notifications.svelte.ts`.
- **Explicit non-goals:** No server outbox cutover or new external channel.
- **Acceptance criteria:** Duplicate realtime/provider payload yields one visible interrupt; focused target suppresses but inbox remains; blocked platform zero notification; old/new payload compatible.
- **Targeted verification:** planned test `apps/web/e2e/g64-notification-shadow.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g64-notification-shadow.spec.ts`; required job: `goal-g64`; case IDs `G64-A01`, `G64-A02`; fixtures: foreground/background, duplicate provider, mobile registered SW, Desktop/browser, privacy; highest proof **P3**; expected artifacts `ci-bundle.g64.json`, `approval-envelope.g64.json`, `merge-envelope.g64.json`, test report and OCI evidence digest.
- **Capability / rollback:** Shadow clients work with legacy push; capabilities unchanged.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G65 — notification dispatch cutover

- **Branch:** `feature/2.5.0-g65-notification-dispatch-cutover`.
- **PR title:** `feat(api): cut addressed delivery to durable notification outbox`.
- **Depends on:** G64; operationally, green G64 merge envelope.
- **Objective:** Activate provider worker only after shadow clients; recheck policy/retract and expose effective readiness.
- **Writable literal paths:** `apps/api/src/domains/messaging/message-service.js`; `apps/api/src/domains/notifications/notification-outbox-repository.js`; `apps/api/src/workers/notification-delivery.js`; `apps/api/src/platform/capabilities.js`; `apps/api/src/platform/readiness.js`; `apps/api/src/lib/config.js`; `apps/api/src/server.js`; `apps/api/test/g65-notification-cutover.test.js`.
- **Read-only literal paths:** `apps/api/src/domains/notifications/notification-service.js`; `apps/api/src/lib/push-service.js`; `config/capability-dag.v1.json`.
- **Explicit non-goals:** No client UI change or reaction push.
- **Acceptance criteria:** Shadow diff matches; settings/retract after claim becomes suppressed/cancelled; failure>5%/100 attempts or 10 failures low traffic stops; oldest>5m warns/>15m disables; worker disagreement fails readiness.
- **Targeted verification:** planned test `apps/api/test/g65-notification-cutover.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g65-notification-cutover.test.js`; required job: `goal-g65`; case IDs `G65-A01`, `G65-A02`; fixtures: shadow diff, policy/retract race, provider outage, dead/age thresholds, replica disagreement; highest proof **P3**; expected artifacts `ci-bundle.g65.json`, `approval-envelope.g65.json`, `merge-envelope.g65.json`, test report and OCI evidence digest.
- **Capability / rollback:** Operator cutover reversible; inbox persists; no resurrection of old revision.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G66 — first unread navigation

- **Branch:** `feature/2.5.0-g66-first-unread-navigation`.
- **PR title:** `feat(web): add stable first-unread navigation`.
- **Depends on:** G65; operationally, green G65 merge envelope.
- **Objective:** Integrate divider/jump with 2.5 exact read and around without wall-clock or full history load.
- **Writable literal paths:** `apps/web/src/lib/shared/chat/read-reconciliation.svelte.ts`; `apps/web/src/lib/shared/notifications/inbox.svelte.ts`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/src/lib/features/home/components/lobby/DmView.svelte`; `apps/web/src/lib/features/home/components/NotificationInbox.svelte`; `apps/web/e2e/g66-first-unread.spec.ts`.
- **Read-only literal paths:** `apps/web/src/lib/api/rooms.ts`; `apps/web/src/lib/api/dm.ts`; `apps/web/src/lib/api/notifications.ts`; `packages/shared/src/messaging-history.js`; `packages/shared/src/notifications.js`.
- **Explicit non-goals:** No claim for actual v2.4.2 render set or DM inbox item.
- **Acceptance criteria:** Receive↔render↔read races keep exact divider; old/deleted/expired boundary works; around load itself writes zero read; focus/keyboard/tabs converge.
- **Targeted verification:** planned test `apps/web/e2e/g66-first-unread.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g66-first-unread.spec.ts`; required job: `goal-g66`; case IDs `G66-A01`, `G66-A02`; fixtures: two tabs, delayed render, old/deleted/expired boundary, legacy-read disclosure; highest proof **P3**; expected artifacts `ci-bundle.g66.json`, `approval-envelope.g66.json`, `merge-envelope.g66.json`, test report and OCI evidence digest.
- **Capability / rollback:** `internal.unreadNavigation=false` hides UI without resetting read state.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G67 — reaction contracts

- **Branch:** `feature/2.5.0-g67-reaction-contracts`.
- **PR title:** `feat(shared): define authoritative reaction and reactor contracts`.
- **Depends on:** G66 and G07; operationally, green G66 merge envelope.
- **Objective:** Define RGI desired-state mutation, summary and full-reactor opaque cursor DTOs without persistence.
- **Writable literal paths:** `packages/shared/src/reactions.js`; `packages/shared/src/reactions.d.ts`; `packages/shared/package.json`; `packages/shared/test/g67-reaction-contract.test.js`.
- **Read-only literal paths:** `packages/shared/src/realtime.js`; `packages/shared/src/validation.js`; `packages/shared/src/emoji.js`; `apps/api/src/platform/cursor-codec.js`.
- **Explicit non-goals:** No migration/repository/API/UI, notification, custom emoji or guest mutation.
- **Acceptance criteria:** RGI canonical identity, desired active boolean, bigint revision, counts/reactedByMe, reactor cursor default50/max100 and guest read-only DTOs validate across CJS/ESM/types.
- **Targeted verification:** planned test `packages/shared/test/g67-reaction-contract.test.js`; exact command: `node --test packages/shared/test/g67-reaction-contract.test.js`; required job: `goal-g67`; case IDs `G67-A01`, `G67-A02`; fixtures: RGI corpus, guest/account, 100+ reactor envelopes, duplicate/no-op revisions and malformed cursors; highest proof **P1**; expected artifacts `ci-bundle.g67.json`, `approval-envelope.g67.json`, `merge-envelope.g67.json`, test report and OCI evidence digest.
- **Capability / rollback:** Public `reactions=false`; contract remains unused until G68/G69.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G68 — reaction persistence repository

- **Branch:** `feature/2.5.0-g68-reaction-persistence-repository`.
- **PR title:** `feat(api): add reaction revisions rows and reactor indexes`.
- **Depends on:** G67 and G07; operationally, green G67 merge envelope.
- **Objective:** Add room/DM reaction/revision schema, repositories and stable full-reactor indexes before routes or UI.
- **Writable literal paths:** `apps/api/src/migrations/20260718135000_create_message_reactions.js`; `apps/api/src/domains/messaging/reaction-repository.js`; `apps/api/test/g68-reaction-persistence.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260614144500_create_rooms_and_room_messages.js`; `apps/api/src/migrations/20260627120000_create_friends_and_direct_messages.js`; `apps/api/src/platform/cursor-codec.js`; `packages/shared/src/reactions.js`; `apps/api/src/lib/migrate.js`.
- **Explicit non-goals:** No mutation/list route, realtime, UI, notification, custom emoji or guest write.
- **Acceptance criteria:** Fresh/v2.4.2 upgrade/repeated no-op/≤5s lock/application rollback pass; unique user/message/RGI row, monotonic bigint revision and `(message_id, created_at, user_id)` indexes converge under concurrent desired-state writes; N-1 ignores tables.
- **Targeted verification:** planned test `apps/api/test/g68-reaction-persistence.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g68-reaction-persistence.test.js`; required job: `goal-g68`; case IDs `G68-A01`, `G68-A02`; fixtures: fresh/upgrade/no-op/lock/application-rollback DB, concurrent desired true/false, 10k reactors and N-1 binary; highest proof **P3**; expected artifacts `ci-bundle.g68.json`, `approval-envelope.g68.json`, `merge-envelope.g68.json`, test report and OCI evidence digest.
- **Capability / rollback:** Public `reactions=false` and `op.reaction.write=false`; additive rows/revisions remain inert.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G69 — reaction api reactors

- **Branch:** `feature/2.5.0-g69-reaction-api-reactors`.
- **PR title:** `feat(api): add reaction mutations summaries and reactor pagination`.
- **Depends on:** G68; operationally, green G68 merge envelope.
- **Objective:** Implement desired-state room/DM mutations and authorized full reactor endpoints using visibility/cursor owners.
- **Writable literal paths:** `apps/api/src/domains/messaging/reaction-service.js`; `apps/api/src/domains/messaging/reaction-routes.js`; `apps/api/src/domains/messaging/reaction-realtime-adapter.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/src/realtime/account-events.js`; `apps/api/test/g69-reaction-api.test.js`.
- **Read-only literal paths:** `apps/api/src/domains/messaging/reaction-repository.js`; `apps/api/src/domains/messaging/message-visibility-service.js`; `packages/shared/src/reactions.js`.
- **Explicit non-goals:** No UI, reaction notifications or guest mutation.
- **Acceptance criteria:** PUT desired state idempotent; p95≤250ms; revisions converge; guest can read room summary/list but receives 403 on mutate; DM only participants; reactor default50/max100 no leak at 10k scale.
- **Targeted verification:** planned test `apps/api/test/g69-reaction-api.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g69-reaction-api.test.js`; required job: `goal-g69`; case IDs `G69-A01`, `G69-A02`; fixtures: concurrent active true/false, reconnect/reorder, guest, cross-context and 10k reactors; highest proof **P3**; expected artifacts `ci-bundle.g69.json`, `approval-envelope.g69.json`, `merge-envelope.g69.json`, test report and OCI evidence digest.
- **Capability / rollback:** `reactions=false`; route/events hidden until Web; stored rows safe.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G70 — reaction web reactors

- **Branch:** `feature/2.5.0-g70-reaction-web-reactors`.
- **PR title:** `feat(web): add accessible reactions and reactor list`.
- **Depends on:** G69; operationally, green G69 merge envelope.
- **Objective:** Render optimistic server-authoritative room/DM reactions and accessible paginated reactor popover.
- **Writable literal paths:** `apps/web/src/lib/api/reactions.ts`; `apps/web/src/lib/shared/chat/reaction-store.svelte.ts`; `apps/web/src/lib/shared/chat/ReactionSummary.svelte`; `apps/web/src/lib/shared/chat/ReactionPicker.svelte`; `apps/web/src/lib/shared/chat/ReactorList.svelte`; `apps/web/src/lib/shared/components/ChatText.svelte`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/src/lib/features/home/model/friends.svelte.ts`; `apps/web/src/lib/features/home/components/lobby/DmView.svelte`; `apps/web/e2e/g70-reactions.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/reactions.js`; `packages/shared/src/emoji.js`; `apps/web/src/lib/api/realtime.ts`.
- **Explicit non-goals:** No custom emoji/reaction notifications or guest mutation control.
- **Acceptance criteria:** Counts never negative and converge under reordered events; guest room sees list with no mutate; reactor load50/max100 cursor; picker/popover keyboard/focus/screen-reader; deleted removes controls.
- **Targeted verification:** planned test `apps/web/e2e/g70-reactions.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g70-reactions.spec.ts`; required job: `goal-g70`; case IDs `G70-A01`, `G70-A02`; fixtures: two accounts+guest, 120 reactors, reorder/reconnect/delete, RGI picker; highest proof **P3**; expected artifacts `ci-bundle.g70.json`, `approval-envelope.g70.json`, `merge-envelope.g70.json`, test report and OCI evidence digest.
- **Capability / rollback:** Enable reactions only after API/Web; false ignores events/hides controls.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G71 — engagement staging checkpoint

- **Branch:** `feature/2.5.0-g71-engagement-staging-checkpoint`.
- **PR title:** `test(staging): close the immutable engagement wave`.
- **Depends on:** G70; operationally, green G70 merge envelope.
- **Objective:** Consolidate content/mentions/inbox/policy/outbox/unread/reaction evidence and test all completed waves together.
- **Writable literal paths:** `docs/releases/2.5.0/evidence/index.json`; `.github/workflows/checkpoint.yml`; `scripts/checkpoints/engagement.mjs`; `scripts/test/g71-engagement-checkpoint.test.mjs`.
- **Read-only literal paths:** `scripts/checkpoints/messaging.mjs`; `scripts/checkpoints/membership.mjs`; `config/capability-dag.v1.json`; `apps/api/src/workers/notification-delivery.js`; `apps/api/src/domains/messaging/reaction-service.js`; `scripts/evidence/recover-from-oci.mjs`.
- **Explicit non-goals:** No media branch/public enablement; performance fixes use reviewed repair goals.
- **Acceptance criteria:** All checksum chains validate; full-on/off and pairwise public/operator matrix passes; five-mention/inbox/worker/reaction budgets and failure thresholds pass; ≥60m observation has zero cross-wave error.
- **Targeted verification:** planned test `scripts/test/g71-engagement-checkpoint.test.mjs`; exact command: `node scripts/test/g71-engagement-checkpoint.test.mjs --verify`; required job: `goal-g71-checkpoint`; case IDs `G71-A01`, `G71-A02`; fixtures: messaging+membership+engagement all-on, pairwise flags, provider/worker failure and N-1 clients; highest proof **P4**; expected artifacts `ci-bundle.g71.json`, `approval-envelope.g71.json`, `merge-envelope.g71.json`, test report and OCI evidence digest.
- **Capability / rollback:** Failure blocks G72; rollback to membership checkpoint digests and repair.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G72 — attachment public contracts

- **Branch:** `feature/2.5.0-g72-attachment-public-contracts`.
- **PR title:** `feat(shared): define image attachment contracts`.
- **Depends on:** G71; operationally, green G71 merge envelope.
- **Objective:** Define up to four JPEG/PNG/WebP attachment states, fallback and room/DM DTOs without storage/schema.
- **Writable literal paths:** `packages/shared/src/attachments.js`; `packages/shared/src/attachments.d.ts`; `packages/shared/package.json`; `packages/shared/test/g72-attachment-contract.test.js`.
- **Read-only literal paths:** `packages/shared/src/realtime.js`; `packages/shared/src/realtime.d.ts`; `apps/web/src/lib/api/rooms.ts`; `apps/web/src/lib/api/dm.ts`; `apps/api/src/lib/avatar-processing.js`.
- **Explicit non-goals:** No DB/storage/upload/worker/UI/GIF/video/audio/docs.
- **Acceptance criteria:** State/context/owner/order/dimensions/bytes validate; max4; image-only has safe text/body fallback; unknown state degrades unavailable.
- **Targeted verification:** planned test `packages/shared/test/g72-attachment-contract.test.js`; exact command: `node --test packages/shared/test/g72-attachment-contract.test.js`; required job: `goal-g72`; case IDs `G72-A01`, `G72-A02`; fixtures: room/DM, 0-5 attachments, unknown state and image-only legacy fallback; highest proof **P1**; expected artifacts `ci-bundle.g72.json`, `approval-envelope.g72.json`, `merge-envelope.g72.json`, test report and OCI evidence digest.
- **Capability / rollback:** mediaRead/mediaUploads false; contracts additive.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G73 — attachment job schema

- **Branch:** `feature/2.5.0-g73-attachment-job-schema`.
- **PR title:** `feat(api): add attachment and media job persistence`.
- **Depends on:** G72; operationally, green G72 merge envelope.
- **Objective:** Create additive message_attachments/media_processing_jobs with legal state constraints and cleanup indexes.
- **Writable literal paths:** `apps/api/src/migrations/20260718140000_create_message_attachments_and_media_jobs.js`; `apps/api/src/domains/media/attachment-repository.js`; `apps/api/src/domains/media/media-job-repository.js`; `apps/api/test/g73-media-schema.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260614144500_create_rooms_and_room_messages.js`; `apps/api/src/migrations/20260627120000_create_friends_and_direct_messages.js`; `apps/api/src/lib/migrate.js`; `docker-compose.yml`; `packages/shared/src/attachments.js`.
- **Explicit non-goals:** No bytes/storage/worker/binding/public route.
- **Acceptance criteria:** Fresh PostgreSQL 16, v2.4.2 upgrade, repeated true no-op, ≤5s blocking lock with lock-loss abort, application rollback/N-1 rescue/startup all pass; legal constraints/indexes/query plans hold, illegal transitions fail and text/body fallback remains.
- **Targeted verification:** planned test `apps/api/test/g73-media-schema.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g73-media-schema.test.js`; required job: `goal-g73`; case IDs `G73-A01`, `G73-A02`; fixtures: fresh PostgreSQL 16, v2.4.2 upgrade, repeated no-op schema/data digest, blocking lock≤5s, forced lock-loss abort, application rollback/N-1 rescue/startup, all legal/illegal states and cleanup query; highest proof **P3**; expected artifacts `ci-bundle.g73.json`, `approval-envelope.g73.json`, `merge-envelope.g73.json`, migration/no-op/lock-loss/application-rollback reports, test report and OCI evidence digest.
- **Capability / rollback:** Media capabilities/operator flags false; tables inert and retained.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G74 — private media storage

- **Branch:** `feature/2.5.0-g74-private-media-storage`.
- **PR title:** `feat(api): add private atomic media storage`.
- **Depends on:** G73; operationally, green G73 merge envelope.
- **Objective:** Implement server-keyed traversal/symlink-safe namespace with atomic save/read/remove/list/free-space.
- **Writable literal paths:** `apps/api/src/domains/media/storage.js`; `apps/api/src/lib/config.js`; `Dockerfile`; `docker-compose.yml`; `docker-compose.ci.yml`; `apps/api/test/g74-media-storage.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/avatar-storage.js`; `apps/api/src/migrations/20260718140000_create_message_attachments_and_media_jobs.js`.
- **Explicit non-goals:** No HTTP routes, S3, worker or cleanup/reconcile policy.
- **Acceptance criteria:** UUID variant keys only; temp→final atomic; stream/idempotent remove; traversal/symlink/foreign namespace reject; avatar namespace unchanged.
- **Targeted verification:** planned test `apps/api/test/g74-media-storage.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g74-media-storage.test.js`; required job: `goal-g74`; case IDs `G74-A01`, `G74-A02`; fixtures: path/encoded traversal, symlink, permission/crash, free-space and avatar regression; highest proof **P2**; expected artifacts `ci-bundle.g74.json`, `approval-envelope.g74.json`, `merge-envelope.g74.json`, test report and OCI evidence digest.
- **Capability / rollback:** No capability; namespace files preserved on rollback.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G75 — media upload validation

- **Branch:** `feature/2.5.0-g75-media-upload-validation`.
- **PR title:** `feat(api): add streaming image slot upload and status`.
- **Depends on:** G74; operationally, green G74 merge envelope.
- **Objective:** Add authenticated draft slot/upload/status/delete with streaming MIME/signature/pixel/size/context/ownership validation.
- **Writable literal paths:** `apps/api/src/domains/media/media-service.js`; `apps/api/src/domains/media/media-routes.js`; `apps/api/src/domains/media/attachment-repository.js`; `apps/api/src/domains/media/storage.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/src/lib/config.js`; `apps/api/test/g75-media-upload.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/avatar-processing.js`; `apps/api/package.json`; `packages/shared/src/attachments.js`.
- **Explicit non-goals:** No quotas beyond single-request bounds, worker/binding/read/UI or guest upload.
- **Acceptance criteria:** JPEG/PNG/WebP≤10MiB/40MP accepted; corrupt/truncated/polyglot/bomb/mismatch/foreign ID rejected without leak; body streams, restart status persists, retry does not duplicate slot.
- **Targeted verification:** planned test `apps/api/test/g75-media-upload.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g75-media-upload.test.js`; required job: `goal-g75`; case IDs `G75-A01`, `G75-A02`; fixtures: valid/EXIF, 10MiB/40MP boundaries, corrupt/polyglot/bomb/cross-user/restart; highest proof **P3**; expected artifacts `ci-bundle.g75.json`, `approval-envelope.g75.json`, `merge-envelope.g75.json`, test report and OCI evidence digest.
- **Capability / rollback:** mediaUploads false/operator accept false; disable rejects new slots and retains drafts.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G76 — media quota reservations

- **Branch:** `feature/2.5.0-g76-media-quota-reservations`.
- **PR title:** `feat(api): enforce media reservations quotas and rates`.
- **Depends on:** G75; operationally, green G75 merge envelope.
- **Objective:** Add atomic pending slots, byte quota and rate reservations independently from disk-pressure/cleanup.
- **Writable literal paths:** `apps/api/src/domains/media/media-quota-repository.js`; `apps/api/src/domains/media/media-quota-service.js`; `apps/api/src/domains/media/media-routes.js`; `apps/api/src/lib/config.js`; `apps/api/src/lib/metrics.js`; `apps/api/test/g76-media-quota.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/rate-limit.js`; `apps/api/src/server.js`; `apps/api/src/domains/media/attachment-repository.js`.
- **Explicit non-goals:** No disk free-space switch, worker or cleanup.
- **Acceptance criteria:** Defaults pending/user8, 20 files/10m, 1GiB; concurrent reservations never exceed; ready+processing bytes count; release/idempotent retry exact; 413 codes stable.
- **Targeted verification:** planned test `apps/api/test/g76-media-quota.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g76-media-quota.test.js`; required job: `goal-g76`; case IDs `G76-A01`, `G76-A02`; fixtures: concurrent 9 slots, byte boundary, rate window, retry/delete release; highest proof **P3**; expected artifacts `ci-bundle.g76.json`, `approval-envelope.g76.json`, `merge-envelope.g76.json`, test report and OCI evidence digest.
- **Capability / rollback:** Operator upload false; quota rows remain for reconciliation.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G77 — media processing worker

- **Branch:** `feature/2.5.0-g77-media-processing-worker`.
- **PR title:** `feat(api): add fenced image processing worker`.
- **Depends on:** G76; operationally, green G76 merge envelope.
- **Objective:** Run Sharp from separate same-image entrypoint using lease fencing and atomic processed/preview writes.
- **Writable literal paths:** `apps/api/src/workers/media-processing.js`; `apps/api/src/domains/media/media-job-repository.js`; `apps/api/src/domains/media/attachment-repository.js`; `apps/api/src/domains/media/storage.js`; `docker-compose.yml`; `docker-compose.ci.yml`; `apps/api/test/g77-media-worker.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/avatar-processing.js`; `apps/api/package.json`; `apps/api/src/platform/lease-runtime.js`; `apps/api/src/lib/config.js`.
- **Explicit non-goals:** No cleanup/reconcile/disk switch/UI/provider service.
- **Acceptance criteria:** Concurrency2/batch10/timeout30s/lease2m/max5/backoff5s–15m; lock loss aborts final DB state; rotate/resize/strip; ready only both files; restart/shutdown/dead safe.
- **Targeted verification:** planned test `apps/api/test/g77-media-worker.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g77-media-worker.test.js`; required job: `goal-g77`; case IDs `G77-A01`, `G77-A02`; fixtures: double worker, lock-loss, crash points, EXIF, timeout, restart/shutdown/dead; highest proof **P3**; expected artifacts `ci-bundle.g77.json`, `approval-envelope.g77.json`, `merge-envelope.g77.json`, test report and OCI evidence digest.
- **Capability / rollback:** MEDIA_WORKER off; stop claims and let lease expire; rows/files preserved.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G78 — media retention cleanup

- **Branch:** `feature/2.5.0-g78-media-retention-cleanup`.
- **PR title:** `feat(api): add bounded media retention cleanup`.
- **Depends on:** G77; operationally, green G77 merge envelope.
- **Objective:** Delete stale uploading/failed temp/unbound ready/deleted physical data in bounded idempotent batches.
- **Writable literal paths:** `apps/api/src/workers/media-maintenance.js`; `apps/api/src/domains/media/media-maintenance-service.js`; `apps/api/src/domains/media/attachment-repository.js`; `apps/api/src/domains/media/media-job-repository.js`; `apps/api/src/domains/media/storage.js`; `apps/api/test/g78-media-cleanup.test.js`.
- **Read-only literal paths:** `apps/api/src/server.js`; `docker-compose.yml`; `apps/api/src/lib/config.js`; `apps/api/src/platform/lease-runtime.js`.
- **Explicit non-goals:** No orphan/missing reconciliation, quota repair or disk-pressure controls.
- **Acceptance criteria:** Uploading/failed temp≤1h, unbound ready≤24h, deleted physical≤1h; batch≤500; referenced ready never deleted; repeated/restart safe; event-loop block≤100ms.
- **Targeted verification:** planned test `apps/api/test/g78-media-cleanup.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g78-media-cleanup.test.js`; required job: `goal-g78`; case IDs `G78-A01`, `G78-A02`; fixtures: age boundaries, bind/delete race, repeated run, 500 rows/files and shutdown; highest proof **P3**; expected artifacts `ci-bundle.g78.json`, `approval-envelope.g78.json`, `merge-envelope.g78.json`, test report and OCI evidence digest.
- **Capability / rollback:** MEDIA_CLEANUP off; disable pauses physical cleanup but access denial remains.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G79 — media reconciliation

- **Branch:** `feature/2.5.0-g79-media-reconciliation`.
- **PR title:** `feat(api): reconcile rows files and quota`.
- **Depends on:** G78; operationally, green G78 merge envelope.
- **Objective:** Detect/remove unreferenced namespace files, mark missing ready unavailable, repair quota and alert deterministically.
- **Writable literal paths:** `apps/api/src/domains/media/media-reconciliation-service.js`; `apps/api/src/workers/media-reconciliation.js`; `apps/api/src/scripts/reconcile-media.js`; `apps/api/src/lib/metrics.js`; `apps/api/test/g79-media-reconcile.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/avatar-reconciliation.js`; `apps/api/src/domains/media/storage.js`; `apps/api/src/domains/media/attachment-repository.js`; `apps/api/src/domains/media/media-job-repository.js`.
- **Explicit non-goals:** No retention policy duplication, disk-pressure decision or backup.
- **Acceptance criteria:** Every documented DB/file crash window converges; missing ready never served and raises P0; unreferenced owned files removed; quota totals match; lock loss prevents stale repair commit.
- **Targeted verification:** planned test `apps/api/test/g79-media-reconcile.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g79-media-reconcile.test.js`; required job: `goal-g79`; case IDs `G79-A01`, `G79-A02`; fixtures: all five crash windows, missing/orphan, quota drift, concurrent bind/read and lock-loss; highest proof **P3**; expected artifacts `ci-bundle.g79.json`, `approval-envelope.g79.json`, `merge-envelope.g79.json`, test report and OCI evidence digest.
- **Capability / rollback:** Reconcile operator false by default; never deletes outside media namespace.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G80 — media disk pressure

- **Branch:** `feature/2.5.0-g80-media-disk-pressure`.
- **PR title:** `feat(api): add fail-closed media disk-pressure controls`.
- **Depends on:** G79; operationally, green G79 merge envelope.
- **Objective:** Measure free space and independently disable new upload/worker claims while active work finishes safely.
- **Writable literal paths:** `apps/api/src/domains/media/media-pressure-service.js`; `config/observability/media-alerts.yml`; `apps/api/src/platform/readiness.js`; `apps/api/src/platform/capabilities.js`; `apps/api/src/lib/config.js`; `apps/api/src/lib/metrics.js`; `apps/api/test/g80-media-pressure.test.js`.
- **Read-only literal paths:** `docker-compose.yml`; `apps/api/src/domains/media/storage.js`; `config/capability-dag.v1.json`.
- **Explicit non-goals:** No cleanup/reconcile implementation or storage expansion.
- **Acceptance criteria:** Default threshold2GiB; below threshold new slots 503 and claims stop; active job completes/lease-recovers; replica disagreement fails mediaUploads readiness; recovery requires hysteresis/configured check.
- **Targeted verification:** planned test `apps/api/test/g80-media-pressure.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g80-media-pressure.test.js`; required job: `goal-g80`; case IDs `G80-A01`, `G80-A02`; fixtures: free-space boundary, drop during job, replica disagreement, recovery/hysteresis; highest proof **P3**; expected artifacts `ci-bundle.g80.json`, `approval-envelope.g80.json`, `merge-envelope.g80.json`, test report and OCI evidence digest.
- **Capability / rollback:** Operator accept/worker claims off; mediaRead unaffected.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G81 — attachment message binding

- **Branch:** `feature/2.5.0-g81-attachment-message-binding`.
- **PR title:** `feat(api): bind ready attachments in the messaging UoW`.
- **Depends on:** G80; operationally, green G80 merge envelope.
- **Objective:** Atomically bind ordered owned ready drafts during idempotent room/DM send with fallback projection.
- **Writable literal paths:** `apps/api/src/domains/messaging/message-service.js`; `apps/api/src/domains/messaging/room-message-repository.js`; `apps/api/src/domains/messaging/direct-message-repository.js`; `apps/api/src/domains/media/attachment-repository.js`; `apps/api/src/domains/messaging/message-routes.js`; `apps/api/test/g81-attachment-binding.test.js`.
- **Read-only literal paths:** `apps/api/src/domains/messaging/message-idempotency-repository.js`; `apps/api/src/domains/notifications/mention-repository.js`; `apps/api/src/domains/notifications/notification-outbox-repository.js`; `packages/shared/src/attachments.js`.
- **Explicit non-goals:** No public byte read/Web UI or binding processing/failed/cross-context drafts.
- **Acceptance criteria:** Message+≤4 bindings commit once; any invalid draft rolls all back; one draft binds once/owner/context; image-only fallback safe; N-1 sees text/body only.
- **Targeted verification:** planned test `apps/api/test/g81-attachment-binding.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g81-attachment-binding.test.js`; required job: `goal-g81`; case IDs `G81-A01`, `G81-A02`; fixtures: room/DM, invalid state, double/cross-owner bind, failure injection/idempotent retry; highest proof **P3**; expected artifacts `ci-bundle.g81.json`, `approval-envelope.g81.json`, `merge-envelope.g81.json`, test report and OCI evidence digest.
- **Capability / rollback:** media capabilities false; old binary ignores rows and reads fallback.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G82 — authorized media read

- **Branch:** `feature/2.5.0-g82-authorized-media-read`.
- **PR title:** `feat(api): add parent-authorized private media delivery`.
- **Depends on:** G81; operationally, green G81 merge envelope.
- **Objective:** Serve preview/processed only through shared message visibility with immediate ban/leave/delete/expiry denial.
- **Writable literal paths:** `apps/api/src/domains/media/media-visibility-service.js`; `apps/api/src/domains/media/media-read-routes.js`; `apps/api/src/domains/media/storage.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `Caddyfile`; `apps/api/test/g82-media-auth.test.js`.
- **Read-only literal paths:** `apps/api/src/domains/messaging/message-visibility-service.js`; `apps/api/src/lib/room-store.js`; `apps/api/src/lib/friend-store.js`; `apps/api/src/domains/media/attachment-repository.js`.
- **Explicit non-goals:** No public/signed URL, storage path response, guest upload or UI.
- **Acceptance criteria:** Draft owner only; DM participants only; room current visibility/ban; guessed/cross-context denied without leak; private cache/safe MIME/name; delete/expiry/ban denial immediate; TTFB≤500ms RC.
- **Targeted verification:** planned test `apps/api/test/g82-media-auth.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g82-media-auth.test.js`; required job: `goal-g82`; case IDs `G82-A01`, `G82-A02`; fixtures: ID enumeration/timing, guest/member/ban/leave/delete/expiry, room/DM and cache headers; highest proof **P3**; expected artifacts `ci-bundle.g82.json`, `approval-envelope.g82.json`, `merge-envelope.g82.json`, test report and OCI evidence digest.
- **Capability / rollback:** mediaRead may enable internally; mediaUploads remains false; rollback keeps safe reads.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G83 — attachment compose web

- **Branch:** `feature/2.5.0-g83-attachment-compose-web`.
- **PR title:** `feat(web): add room and DM image draft compose`.
- **Depends on:** G82; operationally, green G82 merge envelope.
- **Objective:** Add button/drag/drop/paste/progress/retry/remove/reorder and wait-for-ready send.
- **Writable literal paths:** `apps/web/src/lib/api/attachments.ts`; `apps/web/src/lib/shared/chat/attachment-compose.svelte.ts`; `apps/web/src/lib/shared/chat/AttachmentComposer.svelte`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/src/lib/features/home/components/lobby/DmView.svelte`; `apps/web/e2e/g83-attachment-compose.spec.ts`.
- **Read-only literal paths:** `apps/web/src/lib/api/http.ts`; `packages/shared/src/attachments.js`; `apps/web/src/lib/platform/capability-state.svelte.ts`.
- **Explicit non-goals:** No mosaic/lightbox polish, mobile capture, offline queue or background after logout.
- **Acceptance criteria:** Keyboard alternative and a11y pass; invalid/quota/pressure errors actionable; restart resumes status; room/DM stores isolated; failed draft creates zero partial message.
- **Targeted verification:** planned test `apps/web/e2e/g83-attachment-compose.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g83-attachment-compose.spec.ts`; required job: `goal-g83`; case IDs `G83-A01`, `G83-A02`; fixtures: drag/paste/keyboard, restart, quota/pressure/failure, room/DM and logout; highest proof **P3**; expected artifacts `ci-bundle.g83.json`, `approval-envelope.g83.json`, `merge-envelope.g83.json`, test report and OCI evidence digest.
- **Capability / rollback:** mediaUploads internal flag only; disable rejects/aborts new drafts while mediaRead stays.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G84 — attachment mosaic lightbox

- **Branch:** `feature/2.5.0-g84-attachment-mosaic-lightbox`.
- **PR title:** `feat(web): add accessible attachment mosaic and lightbox`.
- **Depends on:** G83; operationally, green G83 merge envelope.
- **Objective:** Render stable 1–4 mosaic, lazy preview, unavailable state and processed-image lightbox/download.
- **Writable literal paths:** `apps/web/src/lib/shared/chat/AttachmentMosaic.svelte`; `apps/web/src/lib/shared/chat/AttachmentLightbox.svelte`; `apps/web/src/lib/shared/chat/attachment.css`; `apps/web/src/lib/shared/components/ChatText.svelte`; `apps/web/src/lib/features/room/components/RoomChat.svelte`; `apps/web/src/lib/features/home/components/lobby/DmView.svelte`; `apps/web/e2e/g84-attachment-view.spec.ts`.
- **Read-only literal paths:** `apps/web/src/lib/api/attachments.ts`; `packages/shared/src/attachments.js`.
- **Explicit non-goals:** No cross-message gallery, editing, original/private URL or mobile redesign.
- **Acceptance criteria:** Known dimensions avoid measurable CLS; focus trap/restore/Escape/arrows/zoom/screen-reader pass; lazy network; authorized download only; room/DM/text+image/image-only/deleted pass.
- **Targeted verification:** planned test `apps/web/e2e/g84-attachment-view.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g84-attachment-view.spec.ts`; required job: `goal-g84`; case IDs `G84-A01`, `G84-A02`; fixtures: 1-4 images, unavailable/deleted, denied download, lazy load and keyboard; highest proof **P3**; expected artifacts `ci-bundle.g84.json`, `approval-envelope.g84.json`, `merge-envelope.g84.json`, test report and OCI evidence digest.
- **Capability / rollback:** mediaRead flag false shows text fallback; stored media unchanged.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G85 — expiry aware rescue digest

- **Branch:** `feature/2.5.0-g85-expiry-aware-rescue-digest`.
- **PR title:** `build(release): freeze the expiry-aware compatibility rescue image`.
- **Depends on:** G84 before any temporary-ban write; operationally, green G84 merge envelope.
- **Objective:** Build and attest a 2.5-derived legacy-profile rescue digest with all new capabilities/operator workers/writes off and expiry-aware bans.
- **Writable literal paths:** `config/rescue/expiry-aware-v2.5.0.json`; `.github/workflows/build-rescue.yml`; `docs/operations/EXPIRY_AWARE_RESCUE.md`; `apps/api/test/g85-rescue-profile.test.js`.
- **Read-only literal paths:** `apps/api/src/lib/room-store.js`; `apps/api/src/platform/capabilities.js`; `apps/api/src/platform/readiness.js`; `config/capability-dag.v1.json`; `config/oci/runtime-packages.v1.json`; `scripts/oci/verify-runtime-provenance.mjs`.
- **Explicit non-goals:** No temporary-ban creation, feature UI, literal v2.4.2 safety claim after activation or public deploy.
- **Acceptance criteria:** Rescue digest serves v2.4.2 envelopes, active-only memberships, safe reads and expiry-aware bans on fully upgraded schema; all new writes/workers zero; old/expired temp ban fixture does not overblock.
- **Targeted verification:** planned test `apps/api/test/g85-rescue-profile.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g85-rescue-profile.test.js`; required job: `goal-g85`; case IDs `G85-A01`, `G85-A02`; fixtures: fully upgraded schema, active/expired temp bans, v2.4.2 client, all flags forced off; highest proof **P4**; expected artifacts `ci-bundle.g85.json`, `approval-envelope.g85.json`, `merge-envelope.g85.json`, test report and OCI evidence digest.
- **Capability / rollback:** After G86 activation this immutable digest is sole binary rollback target; literal v2.4.2 forbidden.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G86 — temporary ban api

- **Branch:** `feature/2.5.0-g86-temporary-ban-api`.
- **PR title:** `feat(api): add temporary ban list create and unban`.
- **Depends on:** G85; operationally, green G85 merge envelope.
- **Objective:** Add owner-only active cursor list and idempotent 1h/1d/7d/permanent create/update/unban while preserving singular adapter.
- **Writable literal paths:** `packages/shared/src/moderation.js`; `packages/shared/src/moderation.d.ts`; `packages/shared/package.json`; `apps/api/src/domains/moderation/moderation-service.js`; `apps/api/src/domains/moderation/moderation-repository.js`; `apps/api/src/domains/moderation/moderation-routes.js`; `apps/api/src/migrations/20260718141000_add_temporary_ban_indexes.js`; `apps/api/src/app.js`; `apps/api/src/server.js`; `apps/api/test/g86-temporary-ban.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260710130000_add_room_bans.js`; `apps/api/src/lib/room-store.js`; `apps/web/src/lib/api/rooms.ts`; `apps/api/src/domains/moderation/active-ban-service.js`; `config/rescue/expiry-aware-v2.5.0.json`.
- **Explicit non-goals:** No moderation UI, roles/reports/audit log or message deletion.
- **Acceptance criteria:** Default50/max100; reason≤500 owner-only; active cap100; same key replay, new key updates active, expired creates new; account vs guest-IP safe; plural auth and legacy permanent adapter; p95≤300ms.
- **Targeted verification:** planned test `apps/api/test/g86-temporary-ban.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g86-temporary-ban.test.js`; required job: `goal-g86`; case IDs `G86-A01`, `G86-A02`; fixtures: duration boundaries, 100 expired, idempotency, owner/nonowner, reason/IP privacy and legacy adapter; highest proof **P3**; expected artifacts `ci-bundle.g86.json`, `approval-envelope.g86.json`, `merge-envelope.g86.json`, test report and OCI evidence digest.
- **Capability / rollback:** moderationCenter false; after first write rollback uses G85 rescue only; enforcement remains.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G87 — message media deletion uow

- **Branch:** `feature/2.5.0-g87-message-media-deletion-uow`.
- **PR title:** `feat(api): delete violating message and revoke media atomically`.
- **Depends on:** G86; operationally, green G86 merge envelope.
- **Objective:** Add owner-authorized room message deletion transaction that marks message/attachments unavailable and schedules cleanup before UI.
- **Writable literal paths:** `apps/api/src/domains/moderation/message-moderation-service.js`; `apps/api/src/domains/messaging/message-service.js`; `apps/api/src/domains/messaging/message-visibility-service.js`; `apps/api/src/domains/media/attachment-repository.js`; `apps/api/src/domains/media/media-job-repository.js`; `apps/api/src/domains/media/media-visibility-service.js`; `apps/api/src/lib/room-store.js`; `apps/api/src/server.js`; `apps/api/test/g87-moderation-delete.test.js`.
- **Read-only literal paths:** `apps/api/src/migrations/20260710120000_add_message_deletion_support.js`; `apps/api/src/domains/moderation/moderation-service.js`; `packages/shared/src/moderation.js`.
- **Explicit non-goals:** No moderation center UI, bulk/DM moderation or physical delete in request.
- **Acceptance criteria:** Authorized owner delete commits message tombstone+attachment denial+cleanup intent atomically; any failure rolls all back; concurrent media read closes immediately after commit; realtime tabs converge.
- **Targeted verification:** planned test `apps/api/test/g87-moderation-delete.test.js`; exact command: `TEST_DATABASE_URL=postgres://... node --test apps/api/test/g87-moderation-delete.test.js`; required job: `goal-g87`; case IDs `G87-A01`, `G87-A02`; fixtures: owner/nonowner, failure injection, concurrent read/bind/cleanup and realtime; highest proof **P3**; expected artifacts `ci-bundle.g87.json`, `approval-envelope.g87.json`, `merge-envelope.g87.json`, test report and OCI evidence digest.
- **Capability / rollback:** Deletion enforcement cannot be rolled back to expose bytes; UI capability still false.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G88 — moderation center web

- **Branch:** `feature/2.5.0-g88-moderation-center-web`.
- **PR title:** `feat(web): add owner moderation center and unified unban`.
- **Depends on:** G87; operationally, green G87 merge envelope.
- **Objective:** Build active-ban list/duration/reason/unban and message-delete UI; 10s undo uses the same idempotent endpoint.
- **Writable literal paths:** `apps/web/src/lib/api/moderation.ts`; `apps/web/src/lib/features/home/components/lobby/ModerationCenter.svelte`; `apps/web/src/lib/features/home/components/lobby/LobbyRoomSettingsDialog.svelte`; `apps/web/src/lib/features/room/components/RoomSettingsDialog.svelte`; `apps/web/src/lib/api/rooms.ts`; `apps/web/e2e/g88-moderation-center.spec.ts`.
- **Read-only literal paths:** `packages/shared/src/moderation.js`; `apps/web/src/lib/platform/capability-state.svelte.ts`.
- **Explicit non-goals:** No roles/reports/audit log/bulk or DM moderation.
- **Acceptance criteria:** Owner-only default50/max100 list; 1h/1d/7d/permanent/reason/empty/error states; undo/center same endpoint; nonowner zero data; delete immediately denies image; keyboard/screen-reader pass.
- **Targeted verification:** planned test `apps/web/e2e/g88-moderation-center.spec.ts`; exact command: `npm --workspace @voice-room/web run e2e -- apps/web/e2e/g88-moderation-center.spec.ts`; required job: `goal-g88`; case IDs `G88-A01`, `G88-A02`; fixtures: owner/nonowner, durations/expiry, reason, undo/multitab and delete-media race; highest proof **P3**; expected artifacts `ci-bundle.g88.json`, `approval-envelope.g88.json`, `merge-envelope.g88.json`, test report and OCI evidence digest.
- **Capability / rollback:** moderationCenter enables only with API/UI; rollback hides UI, keeps enforcement/unban/read denial.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G89 — coordinated media restore

- **Branch:** `feature/2.5.0-g89-coordinated-media-restore`.
- **PR title:** `build(ops): prove coordinated database and media restore`.
- **Depends on:** G88; operationally, green G88 merge envelope.
- **Objective:** Automate and execute consistent PostgreSQL+uploads snapshot/restore/reconcile/access rehearsal in isolated environment.
- **Writable literal paths:** `scripts/backup/create-coordinated-snapshot.mjs`; `scripts/restore/restore-coordinated-snapshot.mjs`; `docs/operations/MEDIA_BACKUP_RESTORE.md`; `.github/workflows/checkpoint.yml`; `scripts/test/g89-restore.test.mjs`.
- **Read-only literal paths:** `docker-compose.yml`; `apps/api/src/domains/media/media-reconciliation-service.js`; `apps/api/src/workers/media-reconciliation.js`; `apps/api/src/scripts/reconcile-media.js`; `apps/api/src/domains/media/storage.js`.
- **Explicit non-goals:** No provider/S3 purchase, production execution or script-only success claim.
- **Acceptance criteria:** Both snapshots share manifest; restore hashes/dimensions/states/access; partial DB-only/files-only fails; pending leases recover; measured RPO≤1h/RTO≤4h.
- **Targeted verification:** planned test `scripts/test/g89-restore.test.mjs`; exact command: `node --test scripts/test/g89-restore.test.mjs`; required job: `goal-g89-restore`; case IDs `G89-A01`, `G89-A02`; fixtures: mixed room/DM attachment states, partial snapshots, pending leases, authorized/denied samples; highest proof **P4**; expected artifacts `ci-bundle.g89.json`, `approval-envelope.g89.json`, `merge-envelope.g89.json`, test report and OCI evidence digest.
- **Capability / rollback:** If budgets/consistency fail mediaUploads remains false; backups/durable files preserved.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G90 — media staging checkpoint

- **Branch:** `feature/2.5.0-g90-media-staging-checkpoint`.
- **PR title:** `test(staging): close the immutable media and moderation wave`.
- **Depends on:** G89; operationally, green G89 merge envelope.
- **Objective:** Consolidate all evidence and run all completed capabilities, workers, rescue rollback, restore and pairwise matrix on immutable staging.
- **Writable literal paths:** `docs/releases/2.5.0/evidence/index.json`; `.github/workflows/checkpoint.yml`; `scripts/checkpoints/media.mjs`; `scripts/test/g90-media-checkpoint.test.mjs`.
- **Read-only literal paths:** `scripts/checkpoints/messaging.mjs`; `scripts/checkpoints/membership.mjs`; `scripts/checkpoints/engagement.mjs`; `config/capability-dag.v1.json`; `config/rescue/expiry-aware-v2.5.0.json`; `apps/api/src/platform/capabilities.js`; `apps/api/src/platform/readiness.js`; `scripts/evidence/recover-from-oci.mjs`.
- **Explicit non-goals:** No public rollout or unreviewed performance repair.
- **Acceptance criteria:** Checksum chain complete; all-on/off/pairwise passes; media failure/pressure/restore/moderation and rescue rollback pass; ≥60m has zero auth leak/missing file/unbounded queue/stop threshold.
- **Targeted verification:** planned test `scripts/test/g90-media-checkpoint.test.mjs`; exact command: `node scripts/test/g90-media-checkpoint.test.mjs --verify`; required job: `goal-g90-checkpoint`; case IDs `G90-A01`, `G90-A02`; fixtures: full product dataset, all workers, disk/provider/LiveKit failure, rescue and N-1 clients; highest proof **P4**; expected artifacts `ci-bundle.g90.json`, `approval-envelope.g90.json`, `merge-envelope.g90.json`, test report and OCI evidence digest.
- **Capability / rollback:** Failure blocks G91; rollback to engagement checkpoint/rescue and repair current wave.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G91 — budget dashboard freeze

- **Branch:** `feature/2.5.0-g91-budget-dashboard-freeze`.
- **PR title:** `perf(platform): freeze release budgets dashboards and alerts`.
- **Depends on:** G90; operationally, green G90 merge envelope.
- **Objective:** Freeze reproducible datasets/budgets and verify already-landed low-cardinality instrumentation; do not hide late code repair in this goal.
- **Writable literal paths:** `scripts/perf/release-250-profile.v1.json`; `docs/operations/RELEASE_2.5.0_BUDGETS.md`; `config/observability/release-250-budgets.yml`; `docs/releases/2.5.0/evidence/index.json`; `scripts/perf/g91-release-budgets.mjs`; `.github/workflows/release-performance.yml`.
- **Read-only literal paths:** `apps/api/src/lib/metrics.js`; `apps/api/src/platform/readiness.js`; `apps/api/src/workers/message-delivery.js`; `apps/api/src/workers/notification-delivery.js`; `apps/api/src/workers/media-processing.js`; `apps/api/src/workers/media-maintenance.js`; `docs/RELEASE_2.5.0_PLAN.md`; `docs/RELEASE_2.5.0_TEST_SPEC.md`.
- **Explicit non-goals:** No feature implementation, broad instrumentation refactor or threshold weakening; missing metric/budget creates separate reviewed repair goal.
- **Acceptance criteria:** Profile records digests/hardware/DB/data/concurrency/seed; exact source budgets and HTTP/queue/media thresholds pass; no user/room/message/IP/storage-key labels; alerts/auto-disable fire.
- **Targeted verification:** planned test `scripts/perf/g91-release-budgets.mjs`; exact command: `node scripts/perf/g91-release-budgets.mjs --profile rc --goal G91`; required job: `goal-g91-perf`; case IDs `G91-A01`, `G91-A02`; fixtures: 500 room/100k DM/10k members/100k inbox/10k reactors, 5 mentions, 100jobs/s, media load; highest proof **P4**; expected artifacts `ci-bundle.g91.json`, `approval-envelope.g91.json`, `merge-envelope.g91.json`, test report and OCI evidence digest.
- **Capability / rollback:** Budget miss blocks G92; narrow capability/operator disable, then reviewed repair.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G92 — full activation matrix

- **Branch:** `feature/2.5.0-g92-full-activation-matrix`.
- **PR title:** `test(release): run pairwise and full cross-wave activation`.
- **Depends on:** G91; operationally, green G91 merge envelope.
- **Objective:** Parse `config/capability-dag.v1.json` and exercise every declared public-key/private-operator prerequisite pair plus all-on/all-off, stale replica and failure combinations on immutable digests.
- **Writable literal paths:** `scripts/checkpoints/g92-activation-matrix.mjs`; `.github/workflows/checkpoint.yml`; `docs/releases/2.5.0/evidence/index.json`; `scripts/test/g92-activation-matrix.test.mjs`.
- **Read-only literal paths:** `config/capability-dag.v1.json`; `scripts/checkpoints/messaging.mjs`; `scripts/checkpoints/membership.mjs`; `scripts/checkpoints/engagement.mjs`; `scripts/checkpoints/media.mjs`.
- **Explicit non-goals:** No implementation repair inside the goal, public production activation or matrix sampling without recorded covering array.
- **Acceptance criteria:** Generated covering array covers all nine public keys, every declared private operator and every DAG edge; no unnamed flag is accepted; full-on survives provider/worker/LiveKit/disk/restart; all-off rescue is safe; stale manifest/prerequisite vector fails readiness.
- **Targeted verification:** planned test `scripts/test/g92-activation-matrix.test.mjs`; exact command: `node scripts/test/g92-activation-matrix.test.mjs --manifest config/capability-dag.v1.json --verify`; required job: `goal-g92-checkpoint`; case IDs `G92-A01`, `G92-A02`; fixtures: exact G14 manifest digest, generated covering array, all-on/off, stale replica, unknown node, worker/provider/LiveKit/disk failures; highest proof **P4**; expected artifacts `ci-bundle.g92.json`, `approval-envelope.g92.json`, `merge-envelope.g92.json`, test report and OCI evidence digest.
- **Capability / rollback:** Any failure blocks entry and creates a scoped current-wave repair branch.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

### G93 — develop release entry

- **Branch:** `feature/2.5.0-g93-develop-release-entry`.
- **PR title:** `test(release): approve develop for the 2.5.0 release branch`.
- **Depends on:** G92 and every predecessor F11 merge envelope; operationally, green G92 merge envelope.
- **Objective:** Materialize tracked `bootstrap-lineage.json` only now as a summary of the immutable external selection/ancestor chain, validate the exact G02–G92 canonical and eligible normal-repair chain, current G03 archive and G12 boundary, and authorize `release/2.5.0`.
- **Writable literal paths:** `docs/releases/2.5.0/evidence/index.json`; `docs/releases/2.5.0/evidence/bootstrap-lineage.json`; `docs/releases/2.5.0/evidence/repair-ledger.json`; `docs/releases/2.5.0/repairs/README.md`; `docs/operations/RELEASE_2.5.0_ENTRY.md`; `scripts/test/g93-entry-gate.test.mjs`; `.github/workflows/release-entry.yml`.
- **Read-only literal paths:** `docs/GIT_FLOW.md`; `docs/releases/2.5.0/evidence/bootstrap-attempts.json`; `docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-lineage.schema.json`; `docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json`; `docs/releases/2.5.0/evidence/archive-map.json`; `docs/releases/2.5.0/evidence/archive-ledger.json`; `.github/workflows/checkpoint.yml`; `.github/workflows/ci.yml`; `.github/workflows/promote-production-digests.yml`; `config/deploy/production-environment-policy.v1.json`; `config/evidence/release-evidence-archive.v1.json`; `config/capability-dag.v1.json`; `scripts/checkpoints/messaging.mjs`; `scripts/checkpoints/membership.mjs`; `scripts/checkpoints/engagement.mjs`; `scripts/checkpoints/media.mjs`; `scripts/checkpoints/g92-activation-matrix.mjs`.
- **Explicit non-goals:** No version bump, release branch, final candidate build, main merge, tag, GitHub release, deploy, production workflow run, environment/policy/secret mutation, edit to G12-owned workflows or post-approval mutation claim.
- **Acceptance criteria:** Exactly one external terminal selection resolves. For recovery, every actual landed merge and external failure object is in develop/parent order, failed nodes remain unselected but covered by `bootstrap_supersession_chain_digest`, and G02 base equals selection `terminal_develop_sha`. G03 contains the selection and all ancestor failures. G93 writes a tracked summary from those immutable inputs without replacing their authority or mutating candidate registries; no bootstrap node enters normal repair. G02–G92 and eligible repair phases bind in order; archive/publication proofs remain current.
- **Targeted verification:** planned test `scripts/test/g93-entry-gate.test.mjs`; exact command: `node --test scripts/test/g93-entry-gate.test.mjs`; required job: `goal-g93`; case IDs `G93-A01`, `G93-A02`; fixtures: one selected 93-canonical chain, abandoned bootstrap attempts incorrectly relabeled/imported, forbidden pre-green R-G01, valid post-bootstrap R-G01, missing/out-of-order/self-expanded repair phases, G03 package deletion/linkage/sentinel drift, hostile ordinary/release spies, possible repository/org secret, zero-environment disabled state, arbitrary ref/modified workflow, exact synthetic v2.5.0 trusted source and merge-method authority/result; highest proof **P4**; expected artifacts `ci-bundle.g93.json`, `approval-envelope.g93.json`, `merge-envelope.g93.json`, bootstrap-exclusion/repair-chain/archive-sentinel/promotion-trusted-source reports, test report and OCI evidence digest. Additional fixtures cover direct/recovery external selection, summary materialization, summary used as early authority, candidate-registry mutation, missing/reordered ancestor, G02 on every unsealed SHA, fabricated F11/selection, bootstrap node imported as repair and supersession-digest mismatch.
- **Capability / rollback:** Failure blocks release branch; repairs must use the two-step authorization then fix protocol and rerun every affected canonical/checkpoint gate.
- **Review-loop exit:** immutable F7 CI/test bundle, parallel code-reviewer `APPROVE` plus architect `CLEAR`, verifier, then immutable F9 approval envelope referencing the bundle; F11 merge envelope must reference both before the next goal.

## 9. Mandatory gates, checkpoints and sequential execution law

### 9.0 Deterministic two-step repair authorization and fix protocol

**Execution amendment:** this protocol remains historical authority for already published G01/G02 evidence and remains available for a material scope/security/persistence/public-contract/production-boundary amendment. It no longer applies to ordinary defects found before a B01–B09 delivery branch merges; those defects are repaired and reverified on the same branch under `docs/RELEASE_2.5.0_EXECUTION_PLAN.md`.

The 93 canonical cards never renumber, and repair authorization/fix branches are not canonical goals. This protocol is unavailable in `G01_PRE_BRANCH`, `G01_PREMERGE_ACTIVE` and `G01_LANDED_UNSEALED`; none permits `R-G01-MM`. It activates only after terminal `G01_SELECTED_GREEN`. Thereafter every eligible G02–G93/checkpoint failure uses this exact sequence; no fix edit is permitted first. Bootstrap recovery remains a separate fresh-consensus lineage, never a normal repair. G05 material architecture discovery uses its stricter literal amendment/re-entry path, not a shortcut repair. The protocol distinguishes a pre-merge failure from an F11/post-merge/checkpoint failure: the card always records the last green predecessor SHA and failing head; when code already landed it additionally records the actual failing merge/develop SHA and never rewrites history.

1. Preserve immutable failure evidence. If failure is pre-merge, close/delete the failed active branch without merge; if it is F11/post-merge/checkpoint, retain current failing `develop` and never reset it. Read the tracked ledger without writing and compute the next unused zero-padded ordinal `MM` for blocked `GNN`; ID is `R-GNN-MM`, and ordinals may never be reused or skipped.
2. Create docs-only branch `feature/2.5.0-r-gNN-mm-authorization` from the last green predecessor SHA; PR title is exactly `docs(gNN): authorize repair rMM` and targets current `develop`. It atomically commits exactly two writable paths: immutable card `docs/releases/2.5.0/repairs/R-GNN-MM.json` and the ledger reservation; no direct develop mutation occurs. Exact read-only inputs are the G01-owned validator/schema plus tracked plan/spec. The card validates against `docs/releases/2.5.0/evidence/schema/repair-authorization.schema.json` and contains: ID/revision/blocked goal+invariant+evidence; objective; literal authorization writable/read-only lists and literal fix allowlist; explicit non-goals; exact planned test path/command/job; exact cases/fixtures/proof/artifacts; acceptance; rollback; invalidated envelopes; affected canonical and checkpoint reruns; predecessor-green SHA; failing head SHA; optional failing merge/develop SHA; authorization target-develop SHA; canonical plan/spec digests; deterministic authorization/fix branches and PR titles; and approval requirements. The exact authorization command is `python3 scripts/test/validate_release_250_plan.py --repair-authorization docs/releases/2.5.0/repairs/R-GNN-MM.json --ledger docs/releases/2.5.0/evidence/repair-ledger.json --plan docs/RELEASE_2.5.0_PLAN.md --spec docs/RELEASE_2.5.0_TEST_SPEC.md`; job `repair-authorization-gNN-rMM`; cases `R-GNN-MM-AUTH-A01/A02`; fixtures include pre-merge and post-merge failures, missing scope, path outside allowlist, stale predecessor/failing/target/plan digest, direct-develop reservation, self-expansion and malformed rerun set; highest proof is the card-selected level, never below the blocked invariant; artifacts are `ci-bundle.repair-authorization-gNN-rMM.json`, `approval-envelope.repair-authorization-gNN-rMM.json` and `merge-envelope.repair-authorization-gNN-rMM.json`.
3. On the exact immutable authorization-card/head digest, run scoped reviews strictly in sequence: Planner `APPROVE`, then Architect `APPROVE`, then Critic `APPROVE`; verifier validates all three immutable object IDs/digests. The G01-owned authorization-envelope schema binds card digest, head SHA, review objects and verdicts without predicting the future in F7. Any mutation/non-approval restarts from Planner. Seal F9, squash-merge the docs-only branch, delete the remote authorization branch, and emit authorization F11 with actual merge SHA/digest and remote deletion only. Delete the local branch as an executor action; the next fix-phase F0/F1 proves it absent.
4. Only after authorization F11, create `feature/2.5.0-r-gNN-mm-fix` from the authorization merge SHA at current `develop` (which includes any already-landed failing canonical merge); PR title is `fix(gNN): execute authorized repair rMM`, job `repair-fix-gNN-rMM`, cases `R-GNN-MM-FIX-A01/A02`, and F7/F9/F11 names are `ci-bundle.repair-fix-gNN-rMM.json`, `approval-envelope.repair-fix-gNN-rMM.json`, `merge-envelope.repair-fix-gNN-rMM.json`. The implementation may edit only the authorization card's literal fix allowlist plus the mechanical ledger authorization-merge binding; it may never edit its own authorization card or broaden objective, paths, proof, acceptance or reruns. Normal exact-head targeted/repository proof, parallel code-reviewer `APPROVE` + architect `CLEAR`, verifier/seal, squash merge and remote deletion apply; subsequent F0/F1 proves local absence.
5. The fix F7/F9/F11 and mechanical ledger binding reference the immutable card digest plus authorization head/approval/merge SHA/digests. After fix F11, rerun every card-declared canonical/checkpoint gate before resuming the blocked sequence. Both remote branches must be closed/deleted and each successor F0/F1 must prove the predecessor local branch absent; no canonical branch may coexist.
6. A scope/proof/rerun change never edits or self-expands an accepted authorization. Allocate a new ordinal/ID on a new authorization branch, mark the prior ID superseded/invalidated in the new ledger reservation, and repeat both phases.

G93 computes the terminal chain in canonical goal order; for each repair it sorts `(blocked_goal_number, ordinal)` and requires phase order `authorization` then `fix`, validating every card/review/authorization-F11/fix-F11 SHA and digest plus rerun closure. Missing, duplicate, reused, skipped, reordered, self-expanded or unbound authorization/fix evidence blocks release.

G93 separately validates abandoned pre-bootstrap G01 attempt references and excludes them from the canonical/repair checksum chain; only post-bootstrap `R-G01-MM` phases may enter that chain.

### 9.1 Consolidated delivery-branch law

The execution unit is one of B01–B09 from `docs/RELEASE_2.5.0_EXECUTION_PLAN.md`:

1. G01–G93 remain stable acceptance/test identifiers; G03–G93 belong to exactly one delivery branch;
2. within a branch, slices execute in dependency order and receive targeted verification before later dependent slices proceed;
3. the final branch head completes every assigned slice test, repository gates, parallel code-reviewer/architect review and the final verifier;
4. each delivery branch receives one F7/F9/F11 chain, one PR to `develop` and one remote-deletion proof;
5. ordinary defects remain on the open delivery branch; material boundary changes use a scoped plan amendment;
6. B02 may overlap early B03 work after B01; B05/B06/B07 may use bounded parallel lanes after their prerequisites; B08 follows B07 and B09 waits for every subsystem merge/checkpoint;
7. atomic invariants such as G57 and G87 remain indivisible even when several agents or commits contribute inside their owning branch.

### 9.2 Gate ledger

| Gate | Must be true before crossing | Closing evidence | Failure action |
| --- | --- | --- | --- |
| G01 bootstrap | canonical docs, validator, total four-state mechanism, exact recovery command and post-F11 external terminal selection work with baseline CI | G01 F7/F9/F11 IDs + SHA-256 followed by immutable external `bootstrap-selection.<attempt-id>.json`; explicitly no OCI | do not implement G02 until exact selected terminal SHA is current develop |
| G02 autonomous CI | clean stack and expanded envelope jobs pass; G01/G02 chains are addressable | G02 three-object chain | do not start G03 |
| G03 durable archive | exact private linked GHCR package, ORAS/permissions/media/attestation/ledger/sentinel and all selected G01/G02 bytes pass; >90-day recovery is digest-only | authenticated package report + append-only map/ledger + manifest attestations/sentinel | no G04; expiry/deletion abandons lineage, never regenerates |
| G05 strict LKV | same issued token denied within approved shape, or blocked experiment has no green F11 | strict ADR/replay; material change uses literal G05 amendment + sequential Planner→Architect→Critic/verifier/merge and restarted G05 | no G06; freeze/close experiment, amend from G04, regenerate plan/spec/trace/ledger, restart G05 |
| G06→G07 Unicode | explicit dependency authority follows license/maintenance/runtime comparison | authority, pinned checksum and corpus | no manifest mutation/reactions |
| G10 ownership | codec, visibility, UoW, identities, lease and worker owners enforced | import-boundary evidence | repair before domain code |
| G11 runtime images | API/Web/worker immutable digests, SBOM/provenance and two non-production consumers pass; G03 archive unchanged | runtime provenance + OCI digests | no G12; no production deploy |
| G12 deploy boundary | ordinary/release events have zero calls/jobs/credential use; absent env, possible repo/org secret, arbitrary ref/workflow or policy mismatch is disabled/nonblocking | zero-call + live disabled report; synthetic exact v2.5.0 tag/workflow/environment-policy routing snapshot only | no G13; publication proceeds disabled; actual side effect blocks |
| G14 capability DAG | exact nine-key v1 manifest/private flags materialized and readiness consumes it | manifest digest + completeness/replica tests | all public false |
| G42 messaging checkpoint | messaging all-on/off/pairwise/N-1/failure safe ≥60m | immutable checkpoint chain | repair messaging only |
| G50 membership checkpoint | active-only behavior and strict credentials pass | immutable membership chain | repair membership only |
| G71 engagement checkpoint | content/mentions/inbox/notification/reactions compose safely | immutable engagement chain | repair engagement only |
| G85 rescue digest | expiry-aware compatibility profile immutable with all new writes/workers off | rescue OCI digest and rehearsal | temporary bans remain impossible |
| G90 media checkpoint | lifecycle/moderation/restore/rescue pass ≥60m | immutable media chain | repair media only |
| G91 budgets | exact frozen budgets and automatic disables pass | benchmark/dashboard/alert artifact | new reviewed repair goal; no threshold weakening |
| G92 activation | covering array generated from the G14 manifest plus all-on/off passes | manifest digest + covering-array result | block G93 |
| G93 entry | one selected G01–G92 chain, abandoned bootstrap exclusions, post-bootstrap repairs, G03 sentinel and G12 trusted-source boundary resolve | develop-entry envelope + exclusion/archive/promotion reports | no release branch |
| Final RC | exact release head/digests pass complete matrix and fresh reviews | release-head bundle+approval+verifier | invalidate candidate and rebuild/retest after reviewed fixes |

### 9.3 Checkpoint dataset and observation

Every checkpoint uses the same versioned seed manifest extended monotonically: at minimum 500 active room messages, 100,000 DM messages, 10,000 room members, 100,000 inbox rows, 10,000 reactors, mixed account/guest identities, active/expired/permanent bans, attachment states, duplicate/reordered events, stale replicas and v2.4.2 client fixtures. Hardware, PostgreSQL/LiveKit/image versions, RNG seed, capability/operator matrix, SHA and OCI digests are recorded. A checkpoint is not green until ≥60 minutes of observation has no P0/P1/P2 correctness, security, durability or rollback issue and no automatic stop threshold.

## 10. Source behavior, budgets and automatic stops

### 10.1 Preserved behavior contracts

- **History:** room and DM endpoints support latest/before/after/around with one server-owned purpose/context-bound opaque cursor; Web never decodes it; GET does not mark read.
- **Reads:** 2.5 exact tuple state is monotonic and conservative. v2.4.2 room wall-clock and DM read-all behavior may clear unrendered messages and is explicitly disclosed; no test may claim reconstruction after a legacy write.
- **Replies:** replying to a reply is allowed, but the returned preview is non-recursive; pointer is immutable; registered and guest room authors are eligible subject to room access; system cards cannot be reply targets.
- **Membership:** row existence means active; leave-room deletes the row; leave-call keeps it; owner static-room restriction, quota, visibility, recipients, directory, leave/rejoin and ban precedence are behavioral compatibility requirements.
- **Mentions:** only active registered room members and the room creator are eligible; no DM, guest, `@everyone` or `@here` mention.
- **Reactions:** server-authoritative RGI identity; account writes only; guests have read-only summaries/reactor lists; full list cursor defaults 50 and rejects limits above 100; UI remains keyboard and screen-reader operable at scale.
- **Moderation:** owner-only active-ban list defaults 50/max100; 1h/1d/7d/permanent; reason ≤500; active cap100; unban is idempotent and shared by undo/center; message deletion atomically revokes media.
- **Desktop:** notification-root behavior is proven on the supported physical desktop RC matrix; browser/PWA assumptions cannot substitute for physical evidence.

### 10.2 Numerical release budgets

| Surface | Required budget and profile | Automatic stop / rollback candidate |
| --- | --- | --- |
| room history and around | warm p95 ≤300ms, p99 ≤750ms, limit50, 500-message room fixture | p95 >1s at ≥1,000 requests/10m or ≥10 requests >1s |
| DM history and around | warm p95 ≤300ms, p99 ≤750ms, limit50, 100k-message conversation | same history stop |
| member autocomplete | p95 ≤200ms at 10,000 members | sustained p95 >400ms/10m or correctness gap |
| inbox | p95 ≤300ms, p99 ≤750ms at 100,000 rows | p99 >1.5s/10m or cursor gap/duplicate |
| five-mention send | p95 ≤500ms excluding external push | p95 >1s/10m or partial UoW |
| notification worker | ≥100 jobs/s with deterministic mock provider | oldest pending >5m warns; >15m disables claims |
| reaction mutation | p95 ≤250ms at 10,000-reactor fixture | p95 >500ms/10m or summary/list divergence |
| migration | any blocking lock ≤5s; lock loss aborts and leaves capability false | >5s lock, dirty schema or lost-lock continuation |
| media slot | p95 ≤300ms | p95 >600ms/10m or quota leak |
| 10MiB/40MP accepted image | `ready` ≤15s under normal profile | valid processing failure >2% at ≥100/15m or ≥5 at lower traffic |
| media read | authorized TTFB ≤500ms | any cross-context read or missing `ready` file is P0 |
| moderation mutation | p95 ≤300ms | p95 >600ms/10m or post-delete byte access |
| cleanup | ≥500 expired rows/run; event-loop delay p95 ≤100ms | queue age >15m, disk hard threshold or failed auto-disable |
| HTTP | normal 5xx below 2% | >2% with ≥100 requests/5m, or ≥10 5xx at low traffic |
| notification delivery | dead-letter and provider failures bounded | any dead row alerts; >10 dead/10m or >5% failures at ≥100/10m (or 10 lower) disables dispatch |
| media queue | oldest pending <5m normal | >5m warns; >15m disables uploads/claims |
| restore | measured RPO ≤1h and RTO ≤4h | either miss blocks release |

Thresholds are frozen in G91. Missing instrumentation is not waived and is not added opportunistically in G91; it creates a new feature repair goal that re-enters F0–F11 and reruns affected checkpoints.

### 10.3 Invariant stops independent of rate

Stop immediately for cursor gap/duplicate; duplicate logical message/inbox/outbox side effect; false credential revocation claim; cross-user/room/DM data or media exposure; stored/reflected XSS; secret/PII/high-cardinality metric label; partial message/mention/inbox/outbox transaction; lost durable file; unbounded retry/queue; capability true without unanimous prerequisites; stale exact-head review/evidence; literal v2.4.2 binary rollback after temporary-ban activation; missing/deleted/unavailable/tampered G03 digest, ledger, linkage or sentinel; omitted/duplicate/out-of-order/self-expanded repair authorization/fix; unresolved G05 material change; any ordinary/release workflow that commits a repository/org production-secret expression, or any event that actually reads/uses a production credential, schedules an environment/production job, contacts production, migrates or deploys; or final-candidate mutation. Before G01, missing archive authority yields `WAITING_EXTERNAL_ARCHIVE_AUTHORITY`, not a lineage stop. After G12, possible/detected repository/org production secret existence, arbitrary dispatch source or optional policy mismatch yields nonblocking `PROMOTION_DISABLED_EXTERNAL_AUTHORITY` with zero scheduling/read/use/contact; it is not itself a publication no-go.

## 11. Release-branch and GitHub release closure

G93 is only a `develop` entry gate. It also proves the complete two-step repair authorization/fix ledger/checksum chain and the G12 no-auto-deploy boundary. Final release work follows `docs/GIT_FLOW.md` and cannot reuse G93 as RC proof.

1. Verify the G93 merge envelope, complete ordered canonical+repair checksum chain, preceding tag `v2.4.2`, clean/fetched `develop`, GitHub authentication/permissions/checks, zero production side effects for ordinary release events, current `PROMOTION_DISABLED_EXTERNAL_AUTHORITY` as the only live pre-tag state plus synthetic trusted-source routing evidence that is not authority, honest unprotected-branch governance, and recorded user/repository-owner authority for the release-only **merge-commit** exception to the repository's default squash method. If authority or repository support is absent, stop before creating the release branch and amend the closure plan.
2. Create `release/2.5.0` from the exact G93-audited `develop` SHA.
3. Make the single initial `chore(release): prepare 2.5.0` commit: set version `2.5.0`, lock/workspace consistency, changelog/release notes, migration/operations notes and final evidence-index references. This version bump is not repeated.
4. Build candidate 1 once from that exact release head; record source/tree/version/migrations/SBOM/API/Web/worker/rescue/evidence digests.
5. Run the complete spec on that exact set: repository/migration/rollback, browsers/a11y/physical desktop, strict LKV, behavioral N-1/rescue, security/workers/media/restore/performance, manifest-derived pairwise/all-on/all-off and ≥60m staging.
6. Open the ready release PR to `main`; record the explicit merge-method authority in its body/check. Run code-reviewer and architect in parallel on the same head (`APPROVE` + `CLEAR`), then verifier and release approval envelope.
7. If RC testing/review fails, add only minimal reviewable fix commit(s) and any corresponding notes correction on the same release branch; keep version `2.5.0`, build one new candidate from the new head, and rerun steps 4–6 in full. Never make a fictitious second version bump or reuse stale candidate evidence.
8. Freeze the approved release branch: no source, notes, lockfile, index or version mutation after approval.
9. Re-run the G12 hostile main/tag/release/backmerge, disabled-secret/environment and arbitrary-ref/workflow trusted-source oracles, then merge with the explicitly authorized GitHub **merge commit**. The merge must contact zero production endpoints and use zero production credentials. Record the selected method and resulting merge SHA; verify the actual `main` merge has the approved release head as parent, identical tree, version `2.5.0` and expected provenance/digests. Squash/rebase/different tree blocks tagging.
10. Create the required **annotated** tag with `git tag -a v2.5.0 <verified-main-sha>` and verify tag object, target, message and ancestry. Cryptographic signing is optional unless repository policy or explicit user authority separately requires `git tag -s`; this plan does not invent a signing requirement.
11. Create the GitHub Release from that annotated tag with checked notes/evidence/SBOM/rollback links; publish metadata only, never rebuild artifacts and prove the release/tag event contacts no production endpoint.
12. Merge the exact tagged release result back into `develop`, verify lineage/version/post-backmerge CI and zero production side effects, then delete `release/2.5.0` locally/remotely last.

Production promotion is optional and outside this plan execution. Current zero-environment/404 and any possible repository/org production-secret scope remain `PROMOTION_DISABLED_EXTERNAL_AUTHORITY`; release completion is valid because G12 removes every legacy reference and the preflight reads/uses nothing. Only after the annotated tag step is complete may a separately authorized future policy become ready: exact dispatch `refs/tags/v2.5.0`, tag-object SHA and peeled verified main release SHA, audited workflow path/Git-blob/reusable digest plus exact `github.workflow_ref`/`github.workflow_sha`, approved immutable API/Web/worker digests, environment `production` with `protected_branches=false`, `custom_branch_policies=true` and sole exact tag `v2.5.0`, required reviewer actor IDs, `prevent_self_review=true`, `can_admins_bypass=false`, frozen job permissions and distinct authorized dispatcher. Arbitrary ref/workflow/policy drift stays disabled/nonblocking. The environment job uses only the frozen least-privilege permissions, captures actual approver after GitHub approval and then may access environment-scoped credentials. This plan creates/configures no environment/policy/secret and runs no promotion.

## 12. Deliberate pre-mortem

| Failure scenario | Earliest signal | Preventive/containment action | Owner / stop |
| --- | --- | --- | --- |
| Strict same-token invalidation is impossible in the pinned topology | G04 replay passes after leave/ban/revoke | G05 blocks; no membership branch; architecture/cost/topology change needs scoped consensus amendment | architect + security reviewer; release blocked |
| Pre-G01 GHCR package/admin/token authority cannot be authenticated | package API/linkage/token-policy proof missing or anonymous NAME_UNKNOWN misread | `WAITING_EXTERNAL_ARCHIVE_AUTHORITY`; no branch/artifact clock; explicit owner authority required | planner + git-master; no G01 |
| G01 fails before installing its own validator/schema | bootstrap CI/review/verifier/merge fails | abandon deterministic attempt, delete branch, no R-G01, fresh full RALPLAN from unchanged baseline | planner; no lineage |
| Evidence package is deleted, unlinked or visibility/actor drifts | scheduled digest sentinel/attestation fails | hard-stop selected lineage; never regenerate; fresh approved lineage | evidence owner; no next goal |
| Optional promotion is dispatched from arbitrary ref or modified workflow | ref/SHA/workflow_ref/workflow_sha/blob/policy mismatch | nonblocking disabled state, no environment job/secret/endpoint | git-master + SRE; publication safe |
| G01/G02 Actions evidence expires during a >90-day external block | archive-recovery fixture cannot resolve source IDs | G03 imports before LKV/authority work; OCI-primary chain and no-regeneration rule | evidence owner; G04 blocked |
| Optional production environment is absent or policy drifts | credentialless preflight returns absent/mismatch | emit `PROMOTION_DISABLED_EXTERNAL_AUTHORITY`; possible repo/org secret also reads/uses nothing; schedule no environment job; publication remains safe | git-master + SRE; promotion disabled, release not blocked |
| Repair scope expands after failure without approved proof | fix diff/path or rerun differs from immutable card | two-step authorization F11 before fix; new ID for any scope change; G93 binding | planner + verifier; next canonical blocked |
| All dormant PRs are green individually but fail when simultaneously enabled | checkpoint/full-matrix cross-wave invariant or 5xx spike | G42/G50/G71/G90 pairwise holds plus G92 covering array/all-on | test-engineer; repair current wave |
| `room_memberships` becomes a hidden history table and old clients overcount active users | owner quota/visibility/recipient N-1 fixture differs | active-only rows, leave DELETE, optional future separate history only | messaging/membership owner; migration blocked |
| Temporary ban expires but literal v2.4.2 treats it as permanent after rollback | rescue/N-1 fixture overblocks | G85 immutable expiry-aware rescue is sole post-activation binary rollback | API owner; temp-ban writes remain off |
| Legacy read is marketed as reconstructable | old DM/room fixture clears unseen rows | explicit known-limitation tests and 2.5-only guarantee | product/API reviewer; documentation blocker |
| Message commits without notification intent or vice versa | failure injection finds partial rows | G56 schema first; G57 one injected-client UoW | messaging owner; P0/P1 stop |
| Stale replica advertises a capability whose schema/worker is absent | readiness disagreement fixture | effective prerequisite DAG fails closed; traffic removed | platform owner; capability off |
| Worker loses lease but continues side effects | lock-loss/renew race duplicates delivery or media transition | fenced lease primitive, abort-on-loss and idempotent domain identity | worker owner; claims disabled |
| Media row/file/backup diverges under crash or disk pressure | missing ready file, orphan growth, restore hash mismatch | reserve/process/reconcile/cleanup state machine, hard pressure disable, G89 restore | media owner; uploads off |
| Unicode dependency becomes unmaintained or legally unsuitable | G06 license/maintenance review unresolved | explicit authority before manifest; pinned data checksum/update policy | dependency-expert; reactions blocked |
| Browser tests pass but physical desktop notification boundary is wrong | G19 supported-version matrix fails | physical manual RC evidence; server/SW suppression remains fail-closed | desktop owner; release blocked |
| Evidence says green for a stale head | F7/F9/F11 digest or SHA differs from CI/reviews/verifier | any mutation restarts bundle + both review lanes + verifier/seal; checksum chain | verifier; merge blocked |
| Release squash/rebase rewrites approved ancestry or tree | main parent/tree/provenance mismatch | release-only merge commit, exact-parent/tree verification before tag | git-master; no tag/release |
| Release merge/tag silently deploys production before verification | hostile G12/G93 main/tag/release spy sees SSH, credential, migration or endpoint call | remove auto-deploy from ordinary CI; require protected manual immutable-digest promotion with separate authority | git-master + SRE; release blocked |
| Late performance repair hides new behavior in dashboard goal | G91 needs code outside profiles/dashboards/alerts | open a new reviewed feature goal and rerun affected checkpoint | planner + perf owner; G92 blocked |
| Queue/provider failure causes an unbounded retry storm | age/dead/failure thresholds cross | operator claims off, safe reads on, bounded backoff/DLQ and alerts | SRE/worker owner; rollback candidate |
| A deletion commits but an in-flight media response continues | hostile concurrent read receives bytes after delete | G87 transaction + authorization recheck/stream abort; security test | media/security owner; P0 stop |

## 13. Staffing, orchestration and handoff

### 13.1 Available agent types

`explore`, `researcher`, `dependency-expert`, `planner`, `architect`, `critic`, `executor`, `test-engineer`, `verifier`, `code-reviewer`, `debugger`, `designer`, `writer`, `git-master`, `code-simplifier` and `vision` are available. `worker` is reserved for an active tmux Team runtime and is not a generic child role.

### 13.2 Recommended execution mode

- **Default:** hand the approved tracked PRD/spec to `$ultragoal`. Its durable ledger mirrors G01→G93 plus the two-step repair authorization/fix ledger. It refuses to activate G02 until the valid post-F11 external direct/recovery selection resolves to current `develop`; thereafter it refuses to activate GNN+1 until GNN F11 is recorded. The release closure is a separate terminal goal after G93.
- **Bounded `$team` use:** only inside the currently active goal when independent lanes materially help. A typical launch hint is `$team 3:executor "Execute only GNN from docs/RELEASE_2.5.0_PLAN.md on its prescribed branch; preserve one-PR scope; return targeted evidence"` from an attached tmux OMX runtime. The leader owns the sole branch, integration and F0–F11 state; workers do not start another goal.
- **Team verification path:** test-engineer runs the named targeted/hostile suite; code-reviewer and architect run in parallel on the same immutable head; verifier runs last and validates their SHAs plus the evidence manifest. Team completion is not merge authority until external CI and F11 are green.
- **`$ralph` fallback:** use only if explicitly selected for a single persistently failing goal with a precise evaluator; it does not replace the Ultragoal ledger or open multiple goals.

### 13.3 Role and reasoning guidance

| Lane | Suggested role / reasoning | Responsibility |
| --- | --- | --- |
| intake/current code mapping | `explore`, low | current symbols, exact file references, no external claims |
| dependency/LiveKit evidence | `researcher` or `dependency-expert`, high | official/upstream facts, licenses, topology/cost boundary |
| goal implementation | `executor`, medium/high by risk | only card touchpoints and tests |
| schema/UoW/LKV/media architecture | `architect`, xhigh | invariant and boundary review |
| test design/failure injection | `test-engineer`, high | case IDs, fixtures, determinism, proof level |
| defect diagnosis | `debugger`, high | root cause and narrow repair |
| review gate | `code-reviewer` + `architect`, high, parallel | `APPROVE` + `CLEAR` on same SHA |
| completion gate | `verifier`, high | exact-head acceptance/evidence/rollback truth |
| Git Flow/release | `git-master`, high | branch/PR/merge/tag/backmerge/deletion evidence |
| docs/release notes | `writer`, high | user truth, legacy limitations and operations |

### 13.4 Product-facing goal-mode follow-up suggestions

- `$ultragoal` — recommended durable sequential execution and checkpoint ledger for this plan.
- `$ultragoal` + `$team` — use when the active goal has bounded independent lanes while retaining one-goal sequencing.
- `$performance-goal` — optional only for a separately approved performance repair produced by G91; it does not own the whole release.
- `$autoresearch-goal` — optional only for a new research question, such as an unapproved alternative LKV topology; synthesize its approved result back through a scoped RALPLAN amendment.
- `$ralph` — explicit single-goal persistence fallback, not the default release orchestrator.

No execution handoff is valid until a fresh Architect review and subsequent Critic `APPROVE` establish the durable RALPLAN consensus record.

## 14. Brownfield source anchors

| Area | Current evidence / integration anchor |
| --- | --- |
| Git Flow and release closure | `docs/GIT_FLOW.md:1-69`; `.github/workflows/ci.yml` |
| source release scope | `docs/RELEASE_2.5.0_PLAN.md`, `docs/RELEASE_2.6.0_PLAN.md`, `docs/RELEASE_2.7.0_PLAN.md` |
| ignored planner artifacts | `.gitignore:47`; therefore G01 tracked canonical docs are mandatory |
| membership and legacy reads | `apps/api/src/lib/room-store.js:201-207,525-541,759-818,840-913` |
| legacy DM read-all | `apps/api/src/lib/friend-store.js:428-437` |
| API composition/config/DB | `apps/api/src/server.js`, `apps/api/src/lib/config.js`, `apps/api/src/lib/db.js` |
| current migrations/tests | `apps/api/src/migrations/**`, `apps/api/test/migration-schema.test.js` |
| realtime/LiveKit | `apps/api/src/realtime/**`, `docker-compose*.yml`, pinned LiveKit invocation in root `package.json` |
| Web room/DM/settings | `apps/web/src/lib/features/home/**`, `apps/web/src/lib/api/**` |
| media precedent | `apps/api/src/lib/avatar-processing.js`, `avatar-storage.js`, `avatar-reconciliation.js` |
| repository gates | root `package.json`: `npm run check`, `npm test`, `npm run build`, `npm run e2e` |

Each goal card's **Current integration touchpoints** is the execution-time starting hypothesis, not a file allowlist proven forever. If fresh `develop` moved the symbol, the active goal records the replacement before editing; cross-domain scope expansion triggers a plan amendment rather than silent absorption.

## 15. Revision changelog

- **Revision 0 — 2026-07-18:** initial unified 60-goal umbrella draft; Architect `ITERATE/BLOCK`, then Critic `ITERATE`.
- **Revision 1 — 2026-07-18 Planner repair:** expanded to 87 meaningful feature goals; removed the fixed cap; split CI/a11y/architecture, contracts/schema/API/Web, preference/settings, shadow/cutover, media maintenance/pressure and deletion/UI concerns while preserving atomic UoWs. Repaired Architect A1–A6 and Critic R1–R5: active-only membership; strict LKV; expiry-aware rescue; disclosed legacy reads; dependency authority; explicit codec/visibility/UoW/identity/lease/worker/capability ownership; notification schema ordering; four wave checkpoints; restored reaction/reply/desktop/source budgets; exact test paths/jobs/cases/fixtures/proof/artifacts; parallel review topology; three-object external evidence; G91 entry gate; exact release-head candidate and verified main merge/tag/backmerge closure. Added cross-wave pre-mortem, staffing, reasoning and goal-mode handoff.
- **Revision 2 — 2026-07-18 Planner repair:** closed Architect R2 B1–B3: satisfiable G01 bootstrap and pre-G10 storage tier; immutable CI/approval/merge envelopes in chronological order; exact nine-key capability/private-operator DAG consumed by G12/G90; split platform/content/reaction contracts from PostgreSQL persistence and split message-outbox UoW from worker; literal planned-path allowlists; amendment verdict, RC-fix, merge authority and annotated-tag wording. Renumbered to 91 goals and revalidated.
- **Revision 3 — 2026-07-18 Planner repair:** expanded to 92 canonical goals by inserting G11 release/deployment decoupling; shifted all downstream cards, manifests, checkpoints, splits and entry references. Made `scripts/test/validate_release_250_plan.py` canonical and required it to audit every primary/secondary planned executable, workflow and storage path; replaced fuzzy evidence-index aliases. Pinned actionlint v1.7.12 through a committed checksum/attestation/version-verified wrapper and immutable tool-lock metadata; removed every implicit package-manager workflow-linter invocation. Made runtime-config proof launch the real Caddy HTTP edge, physical evidence independently attributable, repair branches/ledger/checksum order deterministic, and final release/main/tag/backmerge production-side-effect-free with any later deployment restricted to a separately authorized protected manual digest-promotion workflow.
- **Revision 4 — 2026-07-18 Planner repair:** expanded to 93 canonical goals by inserting G03 durable evidence archive before strict-LKV/dependency/external-authority gates; made only G01–G02 Actions-only and every G03+ envelope OCI-primary with hostile >90-day cache-expiry recovery. Split later G11 runtime image/SBOM publication from evidence archival. Reworked G12 so ordinary/release events are side-effect-free while absent/mismatched `production` yields `PROMOTION_DISABLED_EXTERNAL_AUTHORITY` before any environment job, credential or endpoint; recorded zero environments/production 404 and unprotected branches honestly. Replaced single dynamic repairs with immutable docs-only authorization then fix branches, sequential Planner→Architect→Critic authorization, literal card schema/scope/proof/reruns, distinct F7/F9/F11 chains and G93 terminal binding; renamed the duplicate protocol heading and regenerated all downstream references.
- **Revision 5 — 2026-07-18 Planner repair:** retained 93 canonical goals while adding the non-circular pre-G01 authenticated archive-authority gate and exceptional abandoned-bootstrap-attempt law; froze private repository-linked `ghcr.io/dazegg/voiceroom-release-evidence`, standalone media types/annotations, pinned ORAS v1.3.3 signature/hash/commit verification, exact G03 permissions/GITHUB_TOKEN/attestation, append-only ledger/sentinel and deletion-aware retention. Unified possible repository/org secret and every ref/workflow/policy mismatch as publication-nonblocking `PROMOTION_DISABLED_EXTERNAL_AUTHORITY`, while binding any future ready path to exact verified v2.5.0 tag/SHA/workflow/environment actor policy. Made G05 material discovery a literal Planner→Architect→Critic amendment/re-entry with no green blocked F11; added G73 local migration fixtures, one G35 lease owner and F11-remote/next-F0-local deletion proof.
- **Revision 5 factual correction — 2026-07-18:** corrected SHA `4b101042…c1baf` to the detached archive signature `oras_1.3.3_linux_amd64.tar.gz.asc`, retained `oras_1.3.3_checksums.txt` as a separately hash-pinned asset, and pinned `KEYS` to the immutable source-commit URL while preserving tag-object/commit verification.
- **Revision 6 checkpoint 1 — 2026-07-18 Planner repair:** retained 93 sequential goals and chosen umbrella ADR; normalized exact writable/read-only file catalogs for G01–G31 only; added the four-state G01 bootstrap machine, release-global immutable-ID ordinal reconstruction and dedicated landed-unsealed recovery chain; froze digest-first ORAS bytes/command order, post-approval credentialless policy revalidation with immediate sole credential step, and the exact pre-expiry G03 repair-versus-abandon matrix.
- **Revision 6 checkpoint 2 — 2026-07-18 Planner repair:** extended deterministic literal writable/read-only catalogs and matching trace ownership through G63 without changing B1/N1–N4 or G01–G31 semantics. G64–G93 remain intentionally pending.
- **Revision 6 checkpoint 3/final Planner pass — 2026-07-18:** completed literal writable/read-only catalogs and trace rows through G93, removed every pending marker, made G43 migration-free on the sufficient existing relation, bound G47 exact files to the approved G05 mechanism shape, and retained G93 terminal bootstrap supersession proof. Full cross-card path, deterministic-regeneration and mutation validation is required before Architect review.
- **Revision 7 — 2026-08-06 G47 catalog compatibility:** corrected the G47/G48 catalog to the already-applied `20260720160000_create_livekit_gate_credentials.js` identity and the single authoritative `external-auth-gate.v1.json` config. The immutable mapping, prior canonical digests and rationale are recorded in `docs/releases/2.5.0/amendments/G47-MIGRATION-CATALOG.json`; the applied migration was not renamed or duplicated.
- **Revision 7 Architect-blocker repair — 2026-07-18:** retained exactly four states but made them a total current-attempt partition, placed unconsumed preparation and historical abandoned attempts in PRE_BRANCH, and made the first authoritative PR/run ID the atomic PREMERGE transition. Split tracked known-fact candidate registries from a strictly post-F11 immutable external bootstrap-selection authority; bound G02 to the direct/recovery terminal disjunction and G03/G93 to chronological archive/summary roles. Added the exact recovery subset catalog and invoked the dedicated recovery test/script fixture in the G01/trace command while retaining exactly 93 canonical cards/traces, their literal-catalog guarantee and the 9/10/15 DAG.
- **Pending consensus:** a new role-specific Architect review must approve this PRD and companion test specification; only afterward may a role-specific Critic return `APPROVE`. Until then status remains planning-only and blocked for implementation.
