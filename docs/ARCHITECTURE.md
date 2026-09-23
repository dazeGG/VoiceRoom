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
