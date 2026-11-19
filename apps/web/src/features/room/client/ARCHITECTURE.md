# Room client architecture

The room client is a Vue-owned UI shell around browser-only runtime APIs
(LiveKit, `getUserMedia`, `getDisplayMedia`, fullscreen, the app WebSocket and audio worklets).
Vue owns route structure, room controls, participant tiles, overlays and screen
stage rendering. Client modules own media/session side effects after the lazy
`client/main` import.

## Boundaries

- `core/` keeps shared runtime state, config, session and primitive utilities.
  `core/room-runtime.store.ts` is the reactive room runtime state: one
  module-level reactive object that imperative services import directly and
  components read through `useRoomRuntimeStore().state`. Class instances
  assigned to it (LiveKit `Room`, publications) are marked raw.
- `room/` owns room lifecycle, WebSocket messages and participant domain updates.
- `services/` owns external browser/media integrations. These files stay grouped
  by API lifecycle because capture, publication and teardown order is the bug-prone
  part of the feature.
- `ui/` contains browser/media UI helpers and pure view derivations rather
  than a selector registry.
- `features/room/components/` owns the rendered Vue surfaces: dock, topbar,
  participants, overlays, screen stage and stream tiles. Their styles are the
  partials in `src/styles/room/`.

## Deliberate transitional modules

### Application ports (PR1)

`ports.ts` defines identity, host hooks, feedback and platform contracts plus the
single application-installed binding. `main.ts` in the web composition root
installs `createWebCallPorts(pinia)` after activating Pinia and before creating
the router. The adapter captures that Pinia and acquires stores only inside
actions. Runtime modules acquire ports at action time, never during module
evaluation; public `client/index` imports remain safe before installation.
The binding survives room unmounts because lobby settings and leave actions use
it between calls. Tests install a production adapter or explicit fake and release
the binding on teardown.

Identity exposes call profiles rather than account DTOs. Entry verification keeps
the synchronous embedded account shortcut and standalone fresh session check. It
returns an entry directly for the cached shortcut and a Promise for fresh
verification, so the engine does not insert an await into the shortcut. Its returned
`isCurrent()` retains the session guard, while the engine retains its room-id
guard. Guest feedback IDs remain distinct from realtime/profile identity and are
read only where reports previously read the browser ID.

The nonblocking `host.entered` hook owns permanent-room bookmarks and independent
ownership lookup. The adapter also owns the successful bookmark's `roomsChanged`
emission: it still happens after the bookmark completes and only while the same
entry and room are current. Ownership updates use the same guards; failures keep
the existing debug/warn logging and never delay entry.

Feedback maps directly to the existing store's drop/finished/offer actions; timing,
quality payloads, TTL, cooldown and pending-session restoration are unchanged.
Platform delegates desktop policy and combined browser/desktop visibility, plus
navigation and a typed page read/patch facet. Navigation prepares the in-app mark
at the original call sites, before leaving or transitioning. `navigateToRoom`
defaults to the start flow's `location.href` assignment; its optional `assign`
method preserves the signed-in rejoin flow's existing `location.assign` call.

The five page fields (`screen`, `screenView`, `stripCollapsed`, `stageSummary`,
`desktopScreenFullscreen`) still map to the web page store, so body classes and
views share one value. This is transitional debt: PR3 moves their ownership into
call state and web derives its body classes from that state.

ESLint protects all client TS/Vue files from direct auth, feedback, app page,
desktop-boundary, open-in-app, app-visibility and adapter imports, including literal
dynamic imports. The lobby voice-session store uses the same feedback port.
Synthetic-source ESLint Node API tests verify the boundary without reading product
source text.

| Retained dependency | Completion owner |
| --- | --- |
| Ambient desktop runtime/window, capture/audio/hotkey/load bridges | PR3 platform capability facets; lifecycle unchanged |
| API/realtime transport, `ApiError`, room membership, runtime config | PR3 transport contract and web adapter |
| Room creation API, route URL parsing and `core/session` | PR3 explicit route inputs and host creation/navigation |
| Call-local Pinia stores, embed shell and page facet | PR3 call-owned state and host shell |
| Shared logging, storage, i18n and primitives | PR2 shared UI extraction |
| Web chat/social/moderation, account settings/CTA and leave screens | PR3 host slots around shared call views |

PR1 completes this named import cut, not full package independence. It adds no
mount generations, request tokens or lifecycle scopes; race hardening is separate.

Some service modules are still larger than the preferred component size:

- `screen-capture-service.ts` — source selection, profile constraints and capture
  cleanup share one browser permission lifecycle. The desktop app's native system
  audio (PCM through an AudioWorklet) lives in `desktop-screen-audio.ts`.
- `screen-share-service.ts` — local share state, publication and UI controls must
  update atomically around the same local stream.
- `livekit-service.ts` — connection, publication and subscription handlers depend
  on LiveKit event ordering and should not be split until covered by integration
  tests/mocks.
- `microphone-service.ts` — noise suppression, gating and device fallback are kept
  together to avoid splitting one capture pipeline across files.
- `participants.ts` — participant domain state, remote audio element lifecycle and
  LiveKit track attachment remain imperative; visual rendering lives in Vue.
- `room.ts` — route/lifecycle coordinator; it should remain orchestration-only and
  delegate browser/media details to services. Start-screen actions are in
  `room-start.ts`, the entry check (account or guest name) in `room-entry.ts`, and
  the joined room's voice events in `voice-events.ts`.

New UI work should prefer Vue components plus reactive view derivations instead
of adding new global selectors or cross-module DOM mutation.
