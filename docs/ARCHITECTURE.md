# VoiceRoom architecture

Rules for new code, the current state of the code, and where the two still
differ. Table ownership lives in `ARCHITECTURE_2.5.md` and
`config/import-boundaries.v1.json`. The history of how the API got here
(`server.js` split, CommonJS → ES modules, JavaScript → TypeScript) is in git.

## 1. Repository shape: one monorepo

API, web and `packages/shared` stay in one repository.

- `packages/shared` is a live contract (validators, realtime envelopes, screen
  profile ids, reserved peer ids). One change updates the contract and both
  consumers atomically.
- Versions move in lockstep (2.6.x everywhere), and CI boots the whole stack
  for the voice-join smoke test.
- Deployables are already separate: the `api`, `worker` and `web` images are
  built and rolled out independently.
- The desktop shell is its own repository (own release cadence and signing).

Revisit only with separate teams per side, independent release cadences, or a
public API with third-party clients.

## 2. Languages and runtime

- Everything is strict TypeScript. The API and `packages/shared` run on Node 24
  type stripping with no build step: erasable syntax only, imports with
  explicit `.ts` extensions, `tsc` in `npm run check`. The web is compiled by
  Vite/SvelteKit.
- JavaScript stays only where it must: the byte-pinned `.cjs` migrations,
  `scripts/geoip/fetch-dbip-city-lite.mjs` (host crontabs run it by path), the
  AudioWorklet modules in `apps/web/static` (served unbundled) and
  `apps/web/svelte.config.js`.
- Line endings are LF everywhere (`.gitattributes`).

## 3. API layering

```
transport   domains/<d>/<name>.routes.ts      Fastify handlers: parse, authorize, call, reply
application domains/<d>/<name>.service.ts     use cases; own transactions; no HTTP types
domain      domains/<d>/<name>.policy.ts      pure rules (authorship, moderation, admission)
data        domains/<d>/<name>.repository.ts  SQL; the only writers of their tables
platform    platform/**                       http kit, origin guard, db, readiness
realtime    realtime/**                       WebSocket transport and in-memory presence
composition server.ts, app/**                 config, wiring, bootstrap
```

Rules:

- A handler never touches SQL and never re-implements an authorization rule.
  Every rule about who may act on a resource lives in one policy function that
  both the HTTP route and the WebSocket path call.
- Cross-cutting request checks (origin/CSRF, request ids, security headers)
  are global Fastify hooks, not per-route calls.
- Route input and output are TypeBox schemas registered with Fastify.
- Route modules receive an explicit `ApiContext` plus their dependencies; no
  new module-level singletons.
- Configuration is read only by `app/config.ts` (`readApiConfig(env)`).

## 4. Current state versus these rules

Known gaps, in the order `.omc/plans/improvement-plan.md` closes them. Do not
copy the old pattern into new code.

| Gap | Where | Rule for new code |
| --- | --- | --- |
| Raw `pg` queries with untyped rows; Kysely is wired (`platform/db/kysely.ts`, generated `schema.ts`) but no repository uses it yet | `lib/*-store.ts`, `domains/**/*-repository.ts` | follow the neighbouring repository until the Kysely move lands |
| Each store and several repositories open their own pool | `lib/db.ts` callers, `app/service-registry.ts` | pass an existing pool; never call `createDbPool` in a module |
| `server.ts` builds services at import time and keeps mutable module state | `server.ts`, `app/service-registry.ts` | add dependencies through the registry or a route module's deps |
| Nine route modules have no schemas and take `{ app, ... }` | `membership-routes`, `media-routes`, `message-routes`, `pin-routes`, `reaction-routes`, `moderation-routes`, `notification-routes`, `room-history-routes`, `dm-history-routes` | new routes follow `rooms.routes.ts`: `register(app, ctx, deps)` with TypeBox |
| HTTP response shapes are duplicated by hand in `apps/web/src/lib/api/*`; WebSocket events are `{ type: string; payload: Record<string, unknown> }` | web `lib/api`, `packages/shared/src/realtime.ts` | keep both sides in the same change until shared contracts land |
| Large modules | `lib/room-store.ts`, `realtime/room-runtime.ts`, `server.ts` | add new behaviour in a new domain module, not these files |

## 5. Web layering

```
routes/                 SvelteKit routes (SPA, adapter-static)
lib/features/<f>/        feature UI and state (home, room, auth)
lib/shared/              UI primitives, chat, notifications, utils — never imports features
lib/api/                 HTTP and WebSocket clients
lib/platform/            desktop bridge, capability state
```

- Svelte 5 runes only (`$state`, `$derived`, `$props`, snippets).
- `$effect` synchronises with the outside world (DOM, listeners, timers).
  Values computed from state are `$derived`; reactions to a user action belong
  in the action function, not in an effect watching the state it changed.
- Browser, desktop, media and LiveKit fallbacks stay explicit and testable.
  The room client (`lib/features/room/client`) has its own notes in
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
