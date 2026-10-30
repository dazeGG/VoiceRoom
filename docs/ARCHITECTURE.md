# VoiceRoom architecture

Rules for new code, the current state of the code, and where the two still
differ. Import rules live in `config/import-boundaries.v1.json`. The history of how the API got here
(`server.js` split, CommonJS → ES modules, JavaScript → TypeScript) is in git.

## 1. Repository shape: one monorepo

API, web, admin and `packages/shared` stay in one repository. `apps/admin` is
the React staff console (admin.voiceroom.ru), signed in by handoff from the
main site; it talks to the API's admin routes.

- `packages/shared` is a live contract (validators, realtime envelopes, screen
  profile ids, reserved peer ids). One change updates the contract and both
  consumers atomically.
- Versions move in lockstep (the root and every workspace share one version),
  and CI boots the whole stack for the voice-join smoke test.
- Deployables are already separate: the `api`, `worker` and `web` images are
  built and rolled out independently.
- The desktop shell is its own repository (own release cadence and signing).

Revisit only with separate teams per side, independent release cadences, or a
public API with third-party clients.

## 2. Languages and runtime

- Everything is strict TypeScript. The API and `packages/shared` run on Node 24
  type stripping with no build step: erasable syntax only, imports with
  explicit `.ts` extensions, `tsc` in `npm run check`. The web (Vue 3) is
  compiled by Vite and checked by `vue-tsc`.
- JavaScript stays only where it must: the byte-pinned `.cjs` migrations,
  `scripts/geoip/fetch-dbip-city-lite.mjs` (host crontabs run it by path) and
  the AudioWorklet modules in `apps/web/public` (served unbundled).
- Types are proved, not asserted, and `npm run check` enforces it:
  - No `as` (except `as const`), no non-null `!`, no `any`
    (`consistent-type-assertions: never`, `no-non-null-assertion`,
    `no-explicit-any`). Narrow with a guard or a contract check.
  - ESLint runs `strictTypeChecked` with four rules off (reasons in
    `eslint.config.mjs`): `no-unnecessary-condition` and two siblings trust a
    type over the runtime value, and lib.dom, LiveKit and the desktop bridge
    type optional features as always present; `no-invalid-void-type` is off
    for its own reason.
  - An overload set over an `unknown`-returning implementation is a cast and is
    banned everywhere. The only trust points are
    `apps/api/src/app/store-overrides.ts` (`standIn`) and test doubles under
    `**/test/helpers/**` and `**/test/fakes/**`. Do not add one.
  - Every tsconfig sets `strict`, `noUncheckedIndexedAccess`,
    `noImplicitOverride`, `noFallthroughCasesInSwitch` and
    `exactOptionalPropertyTypes`. A hand-written optional field that accepts
    `undefined` is `?: T | undefined`; contract, DOM and library inputs omit
    the key instead.
  - `scripts/check-type-coverage.mts` holds `type-coverage --strict` at 100% per
    area (api, web, admin, shared, scripts, tests) and rejects
    `type-coverage:ignore`. The byte-pinned `packages/shared/src/emoji.ts` and
    `.cjs` migrations are excluded.
- Line endings are LF everywhere (`.gitattributes`).

## 3. API layering

```
transport   domains/<d>/<name>.routes.ts      Fastify handlers: parse, authorize, call, reply
application domains/<d>/<name>.service.ts     use cases; own transactions; no HTTP types
domain      domains/<d>/<name>.policy.ts      pure rules (authorship, moderation, admission)
data        domains/<d>/<name>.repository.ts  SQL; the only writers of their tables
platform    platform/**                       http kit, origin guard, db
realtime    realtime/**                       WebSocket transport and in-memory presence
composition server.ts, app/**                 entry (server.ts), config, per-app runtime, wiring
```

Rules:

- A handler never touches SQL and never re-implements an authorization rule.
  Every rule about who may act on a resource lives in one policy function that
  both the HTTP route and the WebSocket path call.
- Cross-cutting request checks (origin/CSRF, request ids, security headers)
  are global Fastify hooks, not per-route calls.
- Route input and output are TypeBox schemas registered with Fastify. The
  schemas live in `packages/shared/src/contracts/<domain>.ts`; the web client
  types its calls from the same module, so a payload changes in one place.
- A route lets a service error through: the one error handler
  (`platform/http/http-kit.ts`) answers with the error's status and code, or
  a 500 with the route's `config.errorFallback` code. Routes do not catch to
  format a failure.
- Every failure is `{ ok: false, error, code }` with `code` from
  `contracts/errors.ts` (`ERROR_CODES`). The web shows the text for the code
  (`lib/api/error-texts.ts`, a `Record<ErrorCode, string>`), so adding a code
  without its text fails `npm run check`.
- WebSocket frames are typed by `contracts/realtime.ts`: `ClientCommands` and
  `ServerEvents` map each `type` to its payload. The server builds frames with
  `buildServerEnvelope`, the handler dispatches commands with an exhaustive
  `switch`, and the web receives `ServerEvent`.
- Route modules receive an explicit `ApiContext` plus their dependencies; no
  new module-level singletons.
- Configuration is read only by `app/config.ts` (`readApiConfig(env)`).
- An app is composed by `createApiRuntime({ env })` (`app/api-runtime.ts`):
  the service registry (stores and `domains/<d>/<d>.module.ts` wiring), the
  realtime hub, the domain services and the routes (`app/api-routes.ts`).
  Nothing lives in module scope, so every app a test builds has its own
  state. `server.ts` is only the process entry.
- A rule about who may act on a resource is a pure function in
  `domains/<d>/<name>.policy.ts`; services and realtime paths call it rather
  than repeat the comparison.
- `app/room-store.ts`, `app/user-store.ts` and `app/friend-store.ts` compose
  a domain's repositories into one object for the registry and test overrides.
  Domain and realtime code depend on the repository (or a `Pick` of it) they
  use, never on these composites.
- The process has one pg pool, created by the registry (`connect`) or the
  worker entry, and handed to every repository. Queries are Kysely over the
  generated `platform/db/schema.ts`. A repository-only transaction is
  `db.transaction()`; a service that passes one connection between
  repositories opens it with `transaction(pool, …)` from `platform/db/pool.ts`,
  and the repositories run on it through `kyselyOn(client)`.
- New advisory lock keys go in `lockKeys` (`platform/db/locks.ts`). Every
  writer that adds a ban takes the room admission lock, then the room-bans
  lock; revoking a ban takes the room-bans lock only. Never take them in the
  other order. LISTEN goes through `platform/db/listen.ts`.
- A service fails with a catalogued code by throwing
  `DomainError(code, status, message)` (`platform/http/domain-error.ts`); do
  not add another `*Error` class for that.
- The Android app updates slowly. API and realtime changes stay backward
  compatible for every app version at or above `ANDROID_MIN_VERSION`; raise
  the threshold (and ship a matching app) before removing anything an older
  app uses. The app sends `VoiceRoom-Android/<x.y.z>`; an older one gets HTTP
  426 `client_outdated` and WebSocket close 4426
  (`packages/shared/src/client-version.ts`).

## 4. Current state versus these rules

Old patterns still in the code. Do not copy them. When code falls behind a rule
above, list it here so nobody copies the old pattern.

| Gap | Where | Rule for new code |
| --- | --- | --- |
| Config read and defaulted outside `app/config.ts` | `lib/config.ts`, `lib/logger.ts`, `lib/push-service.ts`, `domains/admission/livekit-config.ts`, `workers/main.ts` (`process.env` default), `scripts/*.ts`, `app/api-runtime.ts` (`process.env` default) | Add the key, default and bound to `app/config.ts`; take the typed config, not `env` or `process.env` |
| LiveKit gate process entry lives in a domain and reads `process.env` | `domains/admission/livekit-auth-gate.service.ts` (`LIVEKIT_GATE_*`, `DATABASE_URL`, opens its own pool) | Process entries sit beside `server.ts` and `workers/main.ts`, read config once and hand the pool in |
| Routes copy the sign-in guard and the 429 reply | `signedIn` helpers and inline `code(401)` in 14 `domains/*/*.routes.ts` files; `Retry-After` replies written per route | Do not write another copy; add one shared guard or reply helper (`app/context.ts`, `platform/http/http-kit.ts`) and use it |
| Routes call the store and each other | `domains/rooms/rooms.routes.ts` (`deps.store()` for list and bookmarks); `ownerRefusal` imported from `rooms.routes.ts` by `media/avatars.routes.ts` and `rooms/peer-moderation.routes.ts`; `messaging/room-chat.service.ts` writes a live peer's `avatarColorKey` | A route calls a service; a service reaches another domain through a port; a helper two modules share is not exported from a routes file |
| The voice runtime is large and forwards a wide deps bag | `realtime/room-runtime.ts`, `realtime/voice-join.ts` | New realtime code depends on a `Pick` of the port it uses and imports pure functions directly; do not add fields to `RoomRuntimeDeps` |
| Two outbox implementations with different lease semantics | `domains/messaging/message-outbox.repository.ts`, `domains/notifications/notification-outbox.repository.ts` (a third claim variant in `domains/media/media-job.repository.ts`) | Do not write another copy; share the lease and claim code before changing either |
| Test seam `standIn` hands a fake over as the store, unchecked | `app/store-overrides.ts`, used in `app/service-registry.ts` | Tests use typed ports or `fake<T>()`; never add a trust point |
| `app/room-store.ts` builds a fallback `ActiveBanService` when no `bans` is injected | `app/room-store.ts` | For tests and scripts only; the app passes its one ban service |
| Advisory lock keys written inline | `account/login-event.repository.ts`, `admission/gate-credential.repository.ts`, `media/attachment.repository.ts`, `messaging/message-idempotency.repository.ts`, `messaging/pin.repository.ts`, `notifications/inbox.repository.ts`, `rooms/room.repository.ts` (all under `domains/`) | Add the key to `lockKeys` and call `lockXact` |
| A ban delete and the address re-keying take no lock | `domains/moderation/room-ban.repository.ts` (`deleteRoomBan`), `domains/moderation/active-ban.repository.ts` (`keyStoredAddresses`) | A new `room_bans` writer takes the room-bans lock |
| Without a database, routes answer 503 `internal_error` | `app/service-registry.ts`, `app/domain-services.ts` (no catalogued code; `http-kit.ts` masks status >= 500) | Add a catalogued code before surfacing a new 503 |
| Device state has two sources of truth | `features/room/room-device-ui.store.ts` against `features/room/client/core/types.ts`, copied by hand in `client/ui/devices.ts` and `client/services/microphone-service.ts` | One owner per value; the UI reads it and the action writes it; type `noiseMode` as `NoiseMode` |
| Reconnect jitter is written three times | `api/realtime.ts`, `features/room/client/recovery/realtime-recovery.ts`, `features/room/client/services/livekit/reconnect-policy.ts` | Do not add a fourth `Math.random()` backoff; share one jitter helper |
| Listbox keyboard handling is copied | `features/home/components/lobby/Sidebar.vue` (own typeahead) against `shared/ui/Select/Select.vue` | Use `Select`; do not write another typeahead |
| Screen profile ids are free strings in the room client | `features/room/client/core/types.ts`, `client/media/profiles.ts` | Narrow ids in the client; keep the wire field `PublicPeer.screenProfileId` a plain string |
| Large components | `shared/chat/EmojiPickerPanel.vue` (506 lines) | Split by concern before adding to it |
| The lobby store is large | `features/home/model/lobby.store.ts` (577 lines) | New lobby state goes in its own store or `use-*.ts` composable, not in `lobby.store.ts` |
| `on(client)` query-shape guard: a value that is not a client falls back to the pool | `domains/media/attachment.repository.ts`, `domains/media/media-job.repository.ts` (`media-job-repository.test.ts` pins the fallback) | Kept on purpose. A new repository takes a typed `QueryClient` and does not guess the shape at run time |
| Optional authorizers with a deny-all default | `domains/media/media-visibility.service.ts` (`authorizeDirectAttachment`, `authorizeRoomAttachment`; production passes both, `release-metrics.test.ts` builds without) | Kept on purpose. A new dependency is required in the factory's type, not optional with a default |
| Nullable pool refused at run time | `domains/messaging/reaction.repository.ts`, `domains/messaging/reply.repository.ts` (`requireQuery` refuses a missing client; `reply-repository.test` asserts the refusal message) | Kept on purpose. Do not add another `requireQuery`; take a non-null client |
| `status: string` taken from the DB column or a metrics label | `domains/notifications/notification-outbox.repository.ts`, `lib/metrics.ts` (`HttpRequestStat`) | Kept on purpose. Narrow a status to a union where the code branches on it |
| Internal error classes that are not a `DomainError` | `MediaError` in `domains/media/storage.ts` (storage codes), `FetchError` in `lib/link-preview-fetcher.ts` (no HTTP status), `MessageDeliveryFenceError` in `domains/messaging/` | An error that reaches a route is a `DomainError` with a catalogued code; add the code first. Keep the internal classes internal |
| Run-time fail-safe on a typed result | `domains/moderation/moderation.service.ts` (`revoked?.status !== 'revoked'` on a typed `PrincipalRevocation` result) | Kept on purpose. Type a new port result as a union |
| Optional `credentialBoundary` | `realtime/room-runtime.ts` (`RuntimeCredentialBoundary \| null`; null without a 32-byte gate secret, then leases revoke through the room store) | Kept on purpose. Do not add another nullable collaborator to `RoomRuntimeDeps` |
| Large lobby components | `features/home/components/lobby/Sidebar.vue` (405 lines), `features/home/LobbyPage.vue` (374 lines) | Extract a composable or a child component before adding to either |

Paths in the web rows are under `apps/web/src/`, the rest under
`apps/api/src/`.

Every release-2.5 feature is on everywhere; `/api/capabilities` answers all of
them true only for clients built before that. Ship new features without a
runtime flag; one that must stay dark is an environment variable read in
`app/config.ts`, like `LINK_PREVIEWS_ENABLED`.

## 5. Web layering

```
main.ts, App.vue, router.ts   app shell: Pinia, vue-router (history mode), route guards
pages/                  one component per route (lobby, room, sign-in, legal, 404)
stores/                 app-wide page state (page.store.ts, the <body> classes)
features/<f>/           feature UI and state (home = the lobby, room, auth, legal,
                        call-feedback, app-update)
entities/               models and components both features use (room realtime,
                        presence, membership, moderation, profile card)
shared/                 UI primitives (Reka UI behind shared/ui), chat,
                        notifications, utils — never imports features
api/                    HTTP and WebSocket clients
platform/               desktop bridge, device boundary
styles/                 SCSS: tokens, mixins and one partial per BEM block
```

- The lobby (`home`) shows rooms; a room never imports the lobby. What a
  room needs from the lobby comes through `provide`/`inject`
  (`features/room/social.ts`); `entities`, `shared`, `platform` and `api`
  never import `features/home` or `features/room`. ESLint enforces both.
- Vue 3 `<script setup lang="ts">` only; the rules are in
  `apps/web/CLAUDE.md`.
- `watch`/`watchEffect` synchronise with the outside world (DOM, listeners,
  timers). Values computed from state are `computed`; reactions to a user
  action belong in the action function, not in a watcher on the state it
  changed.
- App-wide state (session, lobby, inbox, preferences, theme, room runtime and
  room UI) is a Pinia setup store in `*.store.ts`. State owned by one
  component or subject is a `use-*.ts` composable (`useDmThread`,
  `useProfileDraft`, `useLobbyNotifications` in `home/model`;
  `useChatDraft` and `useChatScroll` in `shared/chat`, shared by room chat
  and DMs; `useRoomChatSession` in `features/room`). Context is
  `provide`/`inject` with a typed `InjectionKey` (`provideLobby`/`useLobby`).
  LiveKit objects, media streams, audio nodes and sockets go into reactive
  state only through `markRaw` or `shallowRef`.
- A view that should start fresh for a new subject is mounted per subject
  (`:key` or `v-if`) instead of resetting its state in a watcher: the
  settings mount on every opening and per account, a DM conversation per peer.
- Large surfaces are split by concern: `settings/*` one component per tab,
  `lobby/dm/*` for the direct thread, `RoomChatComposer` and pure layout in
  `room-chat-view.ts` for the room chat, `services/livekit/*` behind
  `livekit-service.ts`.
- Styles: no `<style>` in `.vue` files. Each BEM block has a partial in
  `styles/<area>/_<block>.scss`; colours come from the `--vr-*` tokens in
  `styles/_tokens.scss`, not raw values. State is `aria-*` or a BEM modifier
  class, never a `[data-*]` selector. `scripts/check-web-styles.mts` and
  `scripts/check-web-palette.mts` enforce this in `npm run check`.
- Browser, desktop, media and LiveKit fallbacks stay explicit and testable.
  The room client (`features/room/client`) has its own notes in
  `ARCHITECTURE.md` there.

## 6. Tests

- Tests exercise behaviour: call the module, render the component, send the
  request. They do not read source files and match their text; the only
  allowed file reads are deployment configuration (Caddyfile, compose files,
  Dockerfile, CSP) and migrations. `scripts/check-test-source-reads.mts` in
  `npm run check` fails a test that reads a code file under `src/`.
- API tests run against a real PostgreSQL (`test/db-harness.ts`) where the
  behaviour touches SQL.
- Critical user flows have Playwright coverage under `apps/web/e2e`.

## 7. Runtime state and scaling

Presence, realtime connections and rate-limit counters live in process memory,
so the API runs as exactly one replica. The path to more replicas:

1. Rate limits and login-failure counters move to PostgreSQL (or Redis).
2. Presence moves to a shared store; fan-out uses PostgreSQL LISTEN/NOTIFY,
   which the message outbox already uses.
3. WebSocket sessions become sticky at the proxy.

LiveKit is a single node. Multi-node needs Redis for LiveKit and
region-aware admission.

## 8. Media pipeline

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
