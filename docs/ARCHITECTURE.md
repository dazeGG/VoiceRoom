# VoiceRoom target architecture and migration plan

Status: adopted after the 2.6.4 audit. `ARCHITECTURE_2.5.md` still holds the
table-ownership and import-boundary rules; this document says where the code is
going and in what order.

## 1. Repository shape: stay a monorepo

API, web and `packages/shared` stay in one repository.

- `packages/shared` is a live contract (validators, realtime envelopes, screen
  profile ids, reserved peer ids). One pull request changes the contract and
  both consumers atomically; split repositories would need a published,
  versioned package and paired pull requests for every contract change.
- Versions move in lockstep (2.6.x everywhere), and CI boots the whole stack
  for the voice-join smoke test. Across repositories that becomes cross-repo
  orchestration.
- Deployables are already separate: the `api`, `worker` and `web` images are
  built and rolled out independently. Splitting the repository would not buy a
  deployment boundary that does not exist today.
- The desktop shell is already its own repository, which is right: it has its
  own release cadence and signing.

Revisit only when there are separate teams per side, independent release
cadences, or a public API with third-party clients.

## 2. API layering

```
transport   routes/*.routes.mts   Fastify-native handlers: parse, authorize, call, reply
application *-service.mts         use cases; own transactions; no HTTP types
domain      *-policy.mts          pure rules (authorship, moderation, admission)
data        *-repository.mts      SQL; the only writers of their tables (import-boundaries.v1.json)
platform    platform/**           http kit, origin guard, config, logging, metrics, db pool
realtime    realtime/**           WebSocket transport and in-memory presence
```

Rules:

- A handler never touches SQL and never re-implements an authorization rule.
  Every rule about who may act on a resource lives in one policy function that
  both the HTTP route and the WebSocket path call. The audit's H2 (message
  authorship), M1 (banned reads) and M2 (roster-less admission) were all the
  same bug: a legacy path and a newer domain route each had their own version
  of a check and they drifted apart.
- Cross-cutting request checks are global Fastify hooks, not per-route calls:
  origin/CSRF (`platform/http/origin-guard.mts`), session resolution, request
  ids. A route cannot forget a hook.
- Route input is validated by the shared validators (or a Fastify JSON schema
  built from them) before the handler runs.
- Handlers reply through Fastify. `runLegacyHandler` and its `reply.hijack()`
  go away with `server.js` (see the legacy-handler note in the API guidance).

## 3. Decomposing `server.js`

`apps/api/src/server.js` is ~5.8k lines with ~110 routes, 75 legacy handlers
and all process-wide singletons. It is split by route group, each move a
separate pull request that keeps behaviour and tests unchanged:

| Order | Group | Routes | Destination |
| --- | --- | --- | --- |
| 1 | Platform | healthz, metrics, client-logs, pow-challenge, desktop | `platform/http/*`, `domains/ops/*` |
| 2 | LiveKit admission | livekit-token, server mute, gate revocation | `domains/admission/admission.routes.ts` + `admission.service.ts` |
| 3 | Rooms | create/rename/delete, status, peers, `/api/state`, account room list, kick/server-mute/ban | `domains/rooms/*` (room avatars move with 7, ring with 6) |
| 4 | Legacy room chat | list/post/edit/delete | fold into `domains/messaging` (the newer message routes already exist) |
| 5 | Auth and account | 27 `/api/auth/*` routes | `domains/account/*` |
| 6 | Social | friends, blocks, dm, presence | `domains/social/*` |
| 7 | Push and avatars | push, avatars, link-previews | `domains/notifications/*`, `domains/media/*` |

What remains in `server.js` is composition only: build the context (stores,
services, config), register plugins, hooks and route modules. Target: under
300 lines.

A route module receives an explicit context instead of reaching for
module-level singletons:

```ts
export interface ApiContext {
  config: ApiConfig;
  stores: { rooms: RoomStore; users: UserStore; friends: FriendStore };
  services: { admission: AdmissionService; bans: BanService; /* ... */ };
  presence: PresenceRegistry;
  logger: Logger;
}
export function registerAdmissionRoutes(app: FastifyInstance, ctx: ApiContext): void;
```

## 4. Decisions (agreed 2026-09-23)

| Topic | Decision |
| --- | --- |
| Migration style | Route group by route group (section 3), never a parallel rewrite. Each group is one pull request whose existing tests stay unchanged. |
| Module system | The API package is ES modules (`"type": "module"`) from PR 0 on. Applied migrations are byte-pinned by `test/migration-history-integrity.test.js`, so they stay CommonJS as `.cjs` files (same bytes, same migration names); new migrations are ES modules. |
| Language | TypeScript on Node 24 type stripping, no build step: erasable syntax only, imports with explicit extensions, strict `tsc` in `npm run check`. A module becomes `.ts` when its route group moves; the `.mts` files from before PR 0 are renamed then too. |
| Route input/output | TypeBox schemas next to each route, registered with Fastify (validation + serialization) and giving the handler its types. The shared validators stay the contract with the web client; schemas reuse them through custom formats. |
| Database access | Kysely over the existing `pg` pool for queries; `node-pg-migrate` stays for migrations. Schema types are generated from a migrated database (`kysely-codegen`) and a check fails when they are stale. Repositories move to Kysely with their route group; untouched ones keep raw SQL. The G10 ownership scanner learns `insertInto`/`updateTable`/`deleteFrom`. |
| Dependencies | Route modules get an explicit typed `ApiContext`; no new module-level singletons. |

### PR sequence

0. ES modules for the whole API (codemod `scripts/codemods/cjs-to-esm.mjs`).
1. Skeleton: `ApiContext`, http kit, TypeBox and Kysely wiring with codegen, ops routes (health, metrics, client logs, pow, desktop).
2. LiveKit admission and the SFU side of server mute.
3. Rooms and `/api/state`, including the server-mute HTTP handler.
4. Legacy room chat folded into `domains/messaging`.
5. Auth and account.
6. Friends, blocks, DMs, presence.
7. Push, avatars, link previews.
8. Realtime runtime and the remaining stores.
9. `packages/shared` as one TypeScript source; the `.js`/`.mjs` twins go away.
10. The JavaScript that is left becomes TypeScript: the web leftovers, the API modules domain by domain (then `lib/*`, workers, `service-registry` and `server.js`), then the tests and `scripts/`. Applied migrations stay `.cjs` (byte-pinned); the vendored `static/rnnoise/rnnoise.mjs` stays as shipped; the audio worklets in `apps/web/static` are served unbundled and are decided last.

Done so far:

- PR 0: ES modules (`scripts/codemods/cjs-to-esm.mjs`); applied migrations are `.cjs`.
- PR 1: `app/context.ts` (`ApiContext`), `platform/http/http-kit.ts` (security headers, `no-store`, request metric and log line, `{ ok: false, error }` failures for every Fastify-native route), `platform/db/kysely.ts` with generated `platform/db/schema.ts` (`npm run db:types`, verified by `test/db-schema-types.test.js`), and the ops group in `domains/ops/` (health, metrics, proof-of-work, desktop release, client logs).
- PR 2: the admission group in `domains/admission/`: `admission.service.ts` (who gets a LiveKit JWT and gate credential; returns refusal reasons, revokes an issued credential when a later check fails), `admission.routes.ts` (`POST /api/livekit-token` on TypeBox, same error texts and codes as before), `livekit-admin.ts` (participant removal and the SFU microphone mute), `livekit-config.ts`, plus `platform/crypto/tokens-match.ts`. The moderation handler in `server.js` calls `admission.revokeForServerMute` until PR 3 moves it.
- PR 3: the rooms group in `domains/rooms/`: `rooms.routes.ts` (create, rename, delete, status card, peer preview, `/api/state`, the account room list) over `rooms.service.ts` (room ids, quotas, owner check); `peer-moderation.routes.ts` over `peer-moderation.service.ts` (kick, server mute, ban, undo ban) and `peer-eviction.ts` (the teardown a kick or ban runs on each peer); `room-views.ts` (the peer and lobby-card shapes); `domains/admission/gate-principal.ts`. `platform/http/http-kit.ts` gained `optionalJsonBody` for routes whose legacy handler read a missing body as `{}`.
- PR 4: the legacy room chat in `domains/messaging/`: `room-chat.routes.ts` (list, send, edit, delete, mark read) over `room-chat.service.ts`, which keeps the legacy order of checks and the single send transaction (reply lock, attachments, addressed notifications, outbox, idempotency); `room-chat-views.ts` (the chat message shape) and `message-input.ts` (text, attachment ids, reply ids, idempotency key; DMs use it too).
- PR 5: auth and account in `domains/account/`: `account.routes.ts` (register, login, logout, me, recover, restore, profile, password, recovery codes, devices, sign-in alerts, notices, deletion) over `account.service.ts`, and `session-cookie.ts`. Rate limits and cookies stay in the routes; `ApiContext.resolveSession` now also returns the session record. The avatar routes move with PR 7.
- PR 6a: friends, requests, blocks and ringing a friend into a room in `domains/social/` (`friends.routes.ts` over `friends.service.ts`, `social-views.ts` for the notification actor and active-account check). DMs follow in 6b; presence status and do-not-disturb share the notification preference store and move with PR 7.
- PR 6b: direct messages in `domains/messaging/` (`direct-messages.routes.ts` over `direct-messages.service.ts`): the thread, sending in one transaction (reply lock, attachments, outbox, idempotency), room-invitation answers, edit, delete and read. The delivery relay and DM notifications stay in `server.js` until PR 8.
- PR 7a: notification settings, presence status and push subscriptions in `domains/notifications/` (`notification-settings.routes.ts` over `notification-settings.service.ts`). Avatars and link-preview images follow in 7b.
- PR 7b: account and room avatars and the served image files in `domains/media/` (`avatars.routes.ts` over `avatars.service.ts`). Every HTTP route except the capability routes (`platform/capability-routes.js`, which still take `runLegacyHandler`) is now Fastify-native.
- PR 8a: the in-memory voice roster in `realtime/room-presence.ts`: attaching stored rooms to their live roster, legacy room event delivery, closing a seat from its own transport, the serialized active/empty occupancy writes with retry, the roster wait for admission and the idle-room sweep.
- PR 8b: message projection (`domains/messaging/message-projection.ts`: public attachments and reply quotes), the durable delivery relay that LISTENs for the worker (`message-delivery-relay.ts`), push and DM notification dispatch (`domains/notifications/notification-dispatch.ts`) and link-preview events (`domains/link-previews/link-preview-events.ts`).
- PR 8c: room lifecycle (`domains/rooms/room-lifecycle.ts`: lobby card and room.updated, profile refresh on live seats, invitation expiry, deleted-room teardown), account lifecycle (`domains/account/account-lifecycle.ts`: profile broadcast to friends, ending session connections, finishing due deletions) and the maintenance timers (`platform/maintenance.ts`).
- PR 8d: the lazily built stores and services move to `app/service-registry.js` (`createServiceRegistry(config, deps)` with `applyOverrides` for createApiApp's test doubles, `install` for bootstrap's stores, `close`); what they need from the realtime layer comes in as `deps`. It stays JavaScript while the factories it wires are JavaScript, since their inferred types are too loose to check the wiring.
- PR 8e: every environment variable the API reads at start-up moves to `app/config.ts` (`readApiConfig(env)`, frozen, same names).
- PR 8f: security headers (`platform/http/security-headers.ts`), the request log line (`platform/http/request-log.ts`) and graceful shutdown (`app/graceful-shutdown.ts`) leave `server.js`. `/api/capabilities` was the last route on `runLegacyHandler` and now uses its native path, so it gains the security headers, metric and log line; `runLegacyHandler` and `sendJson` are gone.
- PR 9a: `packages/shared` gets a strict `tsconfig.json` (no Node types, `tsc` in `check`) and its first single-source module, `runtime-config.mts`, exported directly; its `.js`/`.mjs`/`.d.ts` twins are gone. Modules stay `.mts` until the last one moves, then the package switches to `"type": "module"` and they become `.ts`.
- PR 9b: platform-class, mentions, reactions, link-preview, avatar-accent, attachments and visual-identity become single `.mts` sources (visual-identity still reads its JSON).
- PR 9c: validation, realtime, messaging-history, messaging-send and room-message-content become single `.mts` sources; validation and visual-identity share the `AvatarColorKey` type through a type-only import.
- PR 9d: membership, notifications, moderation, capabilities and account-security become single `.mts` sources; only the emoji modules still keep CommonJS, ESM and declaration twins.
- PR 9e: emoji, emoji-groups and emoji-skin-tones become single `.mts` sources (the corpus keeps its G07 hash; coverage ignores `emoji.mts`), so every shared module is now one TypeScript file and `check` is `tsc` alone.
- PR 9f: `packages/shared` switches to `"type": "module"`; its modules are renamed `.mts` → `.ts` and its tests are ES modules. A structure test keeps `src/` to one `.ts` file per export.
- PR 10a: the last six JavaScript modules in `apps/web/src` (realtime heartbeat, realtime and screen recovery, LiveKit reconcile generation, audio output transition, hotkey bindings) become typed `.ts`.
- PR 10b: the rest of `domains/messaging` (history, reads, replies, pins, reactions, idempotency ledger, delivery outbox, realtime adapters) becomes `.ts`. `config/import-boundaries.v1.json` names the `.ts` owners, and its no-deep-shared-imports rule now covers TypeScript sources too; before, it only matched `apps/api/src/**/*.js`.
- PR 10c: `domains/media` (storage, attachment and job repositories, quotas, disk pressure, visibility, maintenance, reconciliation, service, routes) becomes `.ts`. The G08 ratchet now follows a `.js` → `.ts` rename (the old policy path carries over only once the `.js` file is gone), and CI's changed-file list leaves out deleted files.
- PR 10d: `domains/notifications` (inbox, mentions and their eligibility, outbox, service, routes, push provider), `domains/moderation` (active and moderated bans, message moderation, routes) and `domains/membership` (repository, service, member directory, routes) become `.ts`.
- PR 10e: `domains/admission` (gate credential signer, credential boundary, LiveKit credential provider, auth gate service), `domains/link-previews` and the account deletion repository become `.ts`. The G08 collector now reads coverage of TypeScript modules correctly: it accepts scripts V8 reports by filesystem path (a `.ts` module loaded with `require()`) and clamps ranges to the file, since Node appends a `sourceURL` trailer to type-stripped code. New producer cases cover the validate probe's missing content type and a credential issued in the future, so the strict auth-admission files stay at or above 95% after their rename.
- PR 10f: `platform/` (capability routes, cursor codec, lease runtime, readiness report, runtime readiness and its repository, worker heartbeat) becomes `.ts`; the capability route drops its dead `runLegacyHandler` branch and the unused `platform/capabilities.js` re-export is gone. A missed rename in 10e left the compose files starting the gate by its `.js` path; `fix/compose-gate-entrypoint` corrected all four, and `fix/g05-gate-entrypoint-checks` updated the G05 checks that pinned the old path.
- PR 10g: every `lib/` module except the stores becomes `.ts`: config, db pool and transactions, logger and log event codes, client log intake, metrics and the worker metrics server, migrations runner, listener, rate limits, proof of work, password hashing, GeoIP, push endpoint and push service, avatar processing, storage and reconciliation, link preview fetcher, HTML reader, image and storage, and the release 2.5.0 pool. `web-push` ships no types, so `lib/web-push.d.ts` declares the two calls the push service makes, and the notification push provider no longer casts its options.
- PR 10h: the stores (`lib/room-store`, `user-store`, `friend-store`, `notification-store`, `push-store`) become `.ts`. Rows stay `pg`'s untyped records; parameters, results and the gate principal are typed, and each store exports its type (`RoomStore`, `UserStore`, ...). The auth gate no longer casts the room store's options, and `config/import-boundaries.v1.json` names the `.ts` write owners.
- PR 10i: `realtime/` (room runtime, ws handler, connection registry, envelopes, account and legacy event mapping, summaries, typing throttle, peer transport) becomes `.ts`. The registry exports the `WsConnection` shape; the runtime types its reconnect lease record and claim result and takes its dependencies as `RoomRuntimeDeps`, while presence peers and rooms stay loose in-memory records until `server.js` moves in PR 10j.
- PR 10j (workers): `workers/` (entrypoint, message and notification delivery, media processing, maintenance and reconciliation) and `scripts/` (migrate, reconcile-media) become `.ts`. The worker image, the compose migrate service, `db:migrate`/`db:rollback` and the source-reading worker tests start or read them by their `.ts` paths. `app/service-registry.js` and `server.js` follow in the next PR.
- PR 10j (server): `app/service-registry.ts` and `server.ts` become TypeScript, so every API source file is now strict TypeScript except the byte-pinned `.cjs` migrations; tsc checks the composition root, and the separate `server.js` undefined-name scan is no longer needed. The api image, `start`/`dev` and the tests that spawn or read the server use `server.ts`. Typing the wiring tightened a few shared contracts at no runtime cost (the gate principal and room notification level are closed unions, the history repositories take an anchor for every mode but 'latest', the message repositories expose the store methods' real types). Where a domain module still declares a store or payload shape narrower than the typed store (non-null results the store can return null for), `server.ts` bridges it through one identity helper, `bridge()`.
- PR 10k (contracts): `bridge()` is gone. The domain modules now declare what the typed stores really return: nullable results where a store can return null (a missing gate secret, the runtime before createApiApp builds it), the connection registry, deletion repository and room types instead of hand-written look-alikes, closed unions for room creation and principal epochs, a transport that can send on every presence peer, and `updatedAt` on live rooms. Where a module relied on a value being present, a non-null assertion marks that spot in the module itself; list results cast away the mappers' missing-row null. The service registry no longer casts the room store for the credential boundary.
- PR 10k (next): convert the tests (shared, web, API) and `scripts/`, and decide the audio worklets.
- Typed before PR 0: `domains/admission/livekit-token-binding.mts`, `lib/image-signature.mts`, `platform/http/origin-guard.mts`.

## 5. Runtime state and scaling

Presence, realtime connections and rate-limit counters live in process memory,
so the API runs as exactly one replica. That is a documented constraint, not a
bug, at the current scale. The path to more replicas:

1. Rate limits and login-failure counters move to PostgreSQL (or Redis).
2. Presence moves to a shared store; fan-out uses PostgreSQL LISTEN/NOTIFY,
   which the message outbox already uses.
3. WebSocket sessions become sticky at the proxy.

LiveKit is a single node. Multi-node needs Redis for LiveKit and
region-aware admission, and is only worth it if users are spread across
continents (the voice status pill now reports RTT, loss and transport, which
shows whether that is the case).

## 6. Media pipeline (as of this plan)

- Capture: one AudioContext, `source → RNNoise → gate (manual or automatic
  sensitivity) → gain (limiter only above 100%) → destination`, published as
  Opus 64 kbps with DTX and RED.
- Playback: each remote voice plays on its own media element, so Chrome's echo
  canceller uses it as reference; only a boost above 100% goes through the Web
  Audio mix.
- Screen share: VP9 for text, H.264 for motion, VP8 backup, degradation
  preference at publish, 30/60 FPS; screen audio stereo without RED.
- Network: UDP 7882, TCP 7881, and opt-in TURN/TLS on the shared :443
  (`TURN_ENABLED`), plus TURN/UDP 3478.

Next steps not in this plan's scope: DeepFilterNet-class noise suppression
(needs vendored model assets and a CSP-compatible worker, not a CDN blob), a
native audio path in the desktop shell, and LiveKit multi-node.
